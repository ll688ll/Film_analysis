"""Intensity-level analysis: histograms, auto-thresholding, level statistics.

Design note -- why the histogram carries three arrays
-----------------------------------------------------
The client derives every per-level statistic from the histogram so that
dragging a threshold never hits the network. For that derivation to be
*exact* rather than approximate, each bin reports the count, the sum, and the
sum of squares of the actual unquantized values that fell in it::

    n = C0[hi+1] - C0[lo]        # prefix sums of counts
    s = C1[hi+1] - C1[lo]        # prefix sums of sums
    q = C2[hi+1] - C2[lo]        # prefix sums of sumsqs
    mean = s / n
    var  = max(0, q / n - mean ** 2)

Deriving the mean from bin *indices* alone would be exact only for uint8 data
at 256 bins; it would be quietly wrong for the float ``Gray`` and ``Mean``
sources. Two extra float arrays of length ``bins`` buy exactness for every
source and dtype, provided level edges land on bin boundaries -- which the UI
guarantees by storing thresholds as bin indices.

Windowing *excludes* out-of-range pixels rather than clamping them into the
end bins, so a level's reported mean always lies inside its displayed range.
Excluded pixels are reported separately.
"""

from __future__ import annotations

import math

import numpy as np

INTENSITY_SOURCES = ("Gray", "Mean", "Red", "Green", "Blue")
_CHANNEL_INDEX = {"Red": 0, "Green": 1, "Blue": 2}

MIN_BINS = 16
MAX_BINS = 4096
MAX_LEVELS = 16
#: Above this bin count the Otsu DP is solved on a rebinned histogram --
#: its working set is (B + 1) ** 2 float64 (8.4 MB at 1024, 134 MB at 4096).
OTSU_MAX_BINS = 1024

# Rec. 601 luma coefficients.
_LUMA = (0.299, 0.587, 0.114)


# ---------------------------------------------------------------------------
# Image interpretation
# ---------------------------------------------------------------------------


def dtype_info(arr, arr_max=None) -> tuple[str, float | None]:
    """
    Describe the value range implied by *arr*'s dtype.

    Returns ``(name, max_possible)``; ``max_possible`` is None for float data,
    which has no inherent full-scale value.

    PIL returns mode-``I`` 16-bit TIFFs as ``int32``, so an observed *arr_max*
    within 16-bit range is treated as 16-bit rather than 32-bit.
    """
    dt = np.asarray(arr).dtype
    if dt == np.uint8:
        return "uint8", 255.0
    if dt == np.uint16:
        return "uint16", 65535.0
    if np.issubdtype(dt, np.integer):
        if arr_max is not None and arr_max <= 65535:
            return "uint16", 65535.0
        info = np.iinfo(dt)
        return str(dt), float(info.max)
    return "float", None


def extract_intensity_plane(image_array, source: str = "Gray") -> np.ndarray:
    """
    Reduce *image_array* to a single 2-D float32 intensity plane.

    Unlike the dosimetry path this performs no ``/255`` normalisation, so the
    plane keeps the image's native value range at any bit depth.

    Raises
    ------
    ValueError
        If *source* is unknown, or names a colour channel the image lacks.
    """
    if source not in INTENSITY_SOURCES:
        raise ValueError(
            f"Unknown intensity source '{source}'. "
            f"Expected one of {', '.join(INTENSITY_SOURCES)}"
        )

    a = np.asarray(image_array)
    if a.ndim == 2:
        if source in _CHANNEL_INDEX:
            raise ValueError(
                f"Image is grayscale; '{source}' channel is unavailable"
            )
        return a.astype(np.float32)

    if a.ndim != 3:
        raise ValueError(f"Unsupported image shape {a.shape}")

    nch = a.shape[2]
    # LA (grayscale + alpha) and single-channel stacks carry their value in
    # channel 0; only channel 0 is meaningful.
    if nch < 3:
        if source in _CHANNEL_INDEX:
            raise ValueError(
                f"Image has {nch} channel(s); '{source}' is unavailable"
            )
        return a[:, :, 0].astype(np.float32)

    rgb = a[:, :, :3]
    if source in _CHANNEL_INDEX:
        return rgb[:, :, _CHANNEL_INDEX[source]].astype(np.float32)

    # float64 accumulation keeps 16-bit luma from losing precision in the cast
    if source == "Gray":
        r, g, b = (rgb[:, :, i].astype(np.float64) for i in range(3))
        return (_LUMA[0] * r + _LUMA[1] * g + _LUMA[2] * b).astype(np.float32)

    return rgb.mean(axis=2, dtype=np.float64).astype(np.float32)


def build_valid_mask(
    plane: np.ndarray,
    mask=None,
    alpha=None,
    ignore_transparent: bool = False,
    alpha_threshold: float = 0.0,
    exclude_zero: bool = False,
    value_min: float | None = None,
    value_max: float | None = None,
) -> np.ndarray:
    """
    Boolean mask of the pixels that participate in the analysis.

    Combines, in order: finiteness, an ROI *mask*, alpha, zero exclusion, and
    the value window. The histogram, the level statistics, and the transported
    bin-code plane all derive from this same mask, which is what keeps the
    rendered map and the statistics table in agreement.
    """
    valid = np.isfinite(plane)

    if mask is not None:
        valid &= mask

    if ignore_transparent and alpha is not None:
        valid &= alpha > alpha_threshold

    if exclude_zero:
        valid &= plane != 0

    if value_min is not None:
        valid &= plane >= value_min
    if value_max is not None:
        valid &= plane <= value_max

    return valid


# ---------------------------------------------------------------------------
# Histogram
# ---------------------------------------------------------------------------


def _bin_indices(values: np.ndarray, bins: int, vmin: float, vmax: float) -> np.ndarray:
    """Map values to bin indices in ``[0, bins - 1]`` (``vmax`` lands in the last bin)."""
    scale = bins / (vmax - vmin)
    idx = ((values - vmin) * scale).astype(np.int64)
    return np.clip(idx, 0, bins - 1, out=idx)


def compute_histogram(
    plane: np.ndarray,
    bins: int = 256,
    value_min: float | None = None,
    value_max: float | None = None,
    mask=None,
    alpha=None,
    ignore_transparent: bool = False,
    exclude_zero: bool = False,
) -> dict:
    """
    Build the augmented histogram the client derives level statistics from.

    Returns a dict with ``counts`` / ``sums`` / ``sumsqs`` (length *bins*), the
    resolved window, the untouched data range, exclusion tallies, and
    ``overall`` statistics for the analysed pixels.
    """
    if not (MIN_BINS <= bins <= MAX_BINS):
        raise ValueError(f"bins must be between {MIN_BINS} and {MAX_BINS}")

    plane = np.asarray(plane)

    # Pre-window selection: everything except the value range, so the data
    # range and the excluded-pixel tallies can be reported honestly.
    pre = build_valid_mask(
        plane,
        mask=mask,
        alpha=alpha,
        ignore_transparent=ignore_transparent,
        exclude_zero=exclude_zero,
    )
    selected = plane[pre].astype(np.float64)

    total_pixels = int(plane.size)
    selected_count = int(selected.size)
    excluded_nonfinite = int(np.count_nonzero(~np.isfinite(plane)))

    if selected_count:
        data_min = float(selected.min())
        data_max = float(selected.max())
    else:
        data_min, data_max = 0.0, 1.0

    vmin = data_min if value_min is None else float(value_min)
    vmax = data_max if value_max is None else float(value_max)
    if not (vmax > vmin):
        # Constant image, or a degenerate user window.
        vmax = vmin + 1.0

    excluded_low = int(np.count_nonzero(selected < vmin))
    excluded_high = int(np.count_nonzero(selected > vmax))
    values = selected[(selected >= vmin) & (selected <= vmax)]

    if values.size:
        idx = _bin_indices(values, bins, vmin, vmax)
        counts = np.bincount(idx, minlength=bins).astype(np.int64)
        sums = np.bincount(idx, weights=values, minlength=bins)
        sumsqs = np.bincount(idx, weights=values * values, minlength=bins)
        p1, median, p99 = (float(v) for v in np.percentile(values, [1, 50, 99]))
        overall = {
            "mean": float(values.mean()),
            "std": float(values.std()),
            "min": float(values.min()),
            "max": float(values.max()),
            "median": median,
            "p1": p1,
            "p99": p99,
        }
    else:
        counts = np.zeros(bins, dtype=np.int64)
        sums = np.zeros(bins, dtype=np.float64)
        sumsqs = np.zeros(bins, dtype=np.float64)
        overall = {
            "mean": None, "std": None, "min": None, "max": None,
            "median": None, "p1": None, "p99": None,
        }

    return {
        "bins": bins,
        "bin_width": (vmax - vmin) / bins,
        "value_min": vmin,
        "value_max": vmax,
        "data_min": data_min,
        "data_max": data_max,
        "counts": counts.tolist(),
        "sums": sums.tolist(),
        "sumsqs": sumsqs.tolist(),
        "total_count": int(values.size),
        "total_pixels": total_pixels,
        "excluded_nonfinite": excluded_nonfinite,
        "excluded_low": excluded_low,
        "excluded_high": excluded_high,
        "overall": overall,
    }


# ---------------------------------------------------------------------------
# Automatic thresholding
# ---------------------------------------------------------------------------


def _rebin(counts: np.ndarray, sums: np.ndarray, factor: int):
    """Sum adjacent bins in groups of *factor*, padding the tail."""
    bins = len(counts)
    padded = int(math.ceil(bins / factor)) * factor
    c = np.zeros(padded, dtype=np.float64)
    s = np.zeros(padded, dtype=np.float64)
    c[:bins] = counts
    s[:bins] = sums
    return c.reshape(-1, factor).sum(axis=1), s.reshape(-1, factor).sum(axis=1)


def multi_otsu_thresholds(counts, sums, k: int) -> list[int]:
    """
    Multi-level Otsu thresholds, as ``k - 1`` interior bin indices.

    Maximises ``sum(n_c * mu_c ** 2)`` by dynamic programming over the
    histogram, which is equivalent to maximising between-class variance
    because the total count and grand mean are fixed. Exact, not an
    iterative approximation.

    *sums* is required because the class mean must come from real values --
    using bin midpoints instead would bias the result for float sources.
    """
    counts = np.asarray(counts, dtype=np.float64)
    sums = np.asarray(sums, dtype=np.float64)
    bins = len(counts)

    if k <= 1:
        return []
    if bins == 0 or counts.sum() == 0:
        return []

    # Keep the (B + 1) ** 2 DP table to a sane size.
    work_counts, work_sums, factor = counts, sums, 1
    if bins > OTSU_MAX_BINS:
        factor = int(math.ceil(bins / OTSU_MAX_BINS))
        work_counts, work_sums = _rebin(counts, sums, factor)

    edges = _otsu_dp(work_counts, work_sums, k)
    if factor > 1:
        edges = [min(e * factor, bins - 1) for e in edges]
    # Recentre at full resolution, which also refines a coarse rebinned edge.
    edges = [_center_in_tie_plateau(e, counts) for e in edges]

    return _dedupe_increasing(edges, bins, k - 1)


def _center_in_tie_plateau(edge: int, counts: np.ndarray) -> int:
    """
    Move *edge* to the middle of the empty run it sits in, if any.

    When two clusters are cleanly separated the objective is identical for
    every threshold in the empty gap between them, and the DP arbitrarily
    returns the leftmost. That hugs the lower cluster, which reads badly on a
    histogram. Recentring changes no objective value -- only which member of
    an exact tie is reported.
    """
    bins = len(counts)
    lo = int(edge)
    while lo > 0 and counts[lo - 1] == 0:
        lo -= 1
    hi = int(edge)
    while hi < bins and counts[hi] == 0:
        hi += 1
    return (lo + hi) // 2


def _otsu_dp(counts: np.ndarray, sums: np.ndarray, k: int) -> list[int]:
    b = len(counts)
    p0 = np.concatenate(([0.0], np.cumsum(counts)))
    p1 = np.concatenate(([0.0], np.cumsum(sums)))

    # score[i, j] = contribution of a class spanning bins [i, j)
    n = p0[None, :] - p0[:, None]
    s = p1[None, :] - p1[:, None]
    with np.errstate(divide="ignore", invalid="ignore"):
        score = np.where(n > 0, s * s / np.where(n > 0, n, 1.0), 0.0)
    score[np.tril_indices(b + 1)] = -np.inf  # classes must be non-empty ranges

    best = score[0].copy()  # one class covering [0, j)
    back = np.zeros((k, b + 1), dtype=np.int64)
    for c in range(1, k):
        cand = best[:, None] + score
        best_i = np.argmax(cand, axis=0)
        best = cand[best_i, np.arange(b + 1)]
        back[c] = best_i

    j = b
    edges: list[int] = []
    for c in range(k - 1, 0, -1):
        j = int(back[c][j])
        edges.append(j)
    return sorted(edges)


def kmeans_1d_thresholds(counts, centers, k: int, iters: int = 50) -> list[int]:
    """
    1-D weighted k-means (Lloyd's) over the histogram.

    Returns ``k - 1`` interior bin indices at the midpoints between adjacent
    converged centroids. Cheaper than the Otsu DP and often a better fit when
    classes have very unequal spreads.
    """
    counts = np.asarray(counts, dtype=np.float64)
    centers = np.asarray(centers, dtype=np.float64)
    bins = len(counts)

    if k <= 1 or bins == 0 or counts.sum() == 0:
        return []

    # Seed at quantiles of the weighted distribution so empty seeds are rare.
    cdf = np.cumsum(counts) / counts.sum()
    quantiles = (np.arange(k) + 0.5) / k
    seeds = centers[np.searchsorted(cdf, quantiles, side="left").clip(0, bins - 1)]
    centroids = np.unique(seeds)
    if len(centroids) < k:
        lo, hi = centers[0], centers[-1]
        centroids = np.linspace(lo, hi, k)

    nonempty = counts > 0
    for _ in range(iters):
        assign = np.abs(centers[:, None] - centroids[None, :]).argmin(axis=1)
        moved = False
        for c in range(k):
            sel = nonempty & (assign == c)
            w = counts[sel]
            if w.sum() == 0:
                continue
            new = float((centers[sel] * w).sum() / w.sum())
            if new != centroids[c]:
                centroids[c] = new
                moved = True
        centroids.sort()
        if not moved:
            break

    midpoints = (centroids[:-1] + centroids[1:]) / 2.0
    edges = [int(np.searchsorted(centers, m, side="left")) for m in midpoints]
    return _dedupe_increasing(edges, bins, k - 1)


def _dedupe_increasing(edges: list[int], bins: int, wanted: int) -> list[int]:
    """Clamp to ``[1, bins - 1]`` and force strict increase, dropping duplicates."""
    out: list[int] = []
    for e in sorted(edges):
        e = int(min(max(e, 1), bins - 1))
        if out and e <= out[-1]:
            e = out[-1] + 1
        if e >= bins:
            break
        out.append(e)
    return out[:wanted]


def equal_width_edges(bins: int, levels: int) -> list[int]:
    """Interior bin indices splitting ``[0, bins)`` into equal-width levels."""
    edges = [round(i * bins / levels) for i in range(1, levels)]
    return _dedupe_increasing(edges, bins, levels - 1)


def equal_count_edges(counts, levels: int) -> list[int]:
    """Interior bin indices splitting the histogram into near-equal populations."""
    counts = np.asarray(counts, dtype=np.float64)
    total = counts.sum()
    bins = len(counts)
    if total == 0 or levels <= 1:
        return []
    cum = np.cumsum(counts)
    targets = [i * total / levels for i in range(1, levels)]
    edges = [int(np.searchsorted(cum, t, side="left")) + 1 for t in targets]
    # Same tie as in Otsu: anywhere inside an empty run yields identical
    # populations, so report the middle rather than hugging the lower cluster.
    edges = [_center_in_tie_plateau(e, counts) for e in edges]
    return _dedupe_increasing(edges, bins, levels - 1)


# ---------------------------------------------------------------------------
# Exact level statistics (full-resolution oracle)
# ---------------------------------------------------------------------------


def level_stats(
    plane: np.ndarray,
    edges,
    mask=None,
    alpha=None,
    ignore_transparent: bool = False,
    exclude_zero: bool = False,
) -> list[dict]:
    """
    Per-level statistics computed directly from the full-resolution plane.

    This is the oracle the client-side prefix-sum derivation is validated
    against, and what ``/level-stats`` serves when a user asks for exact
    numbers. *edges* is a list of ``k + 1`` boundary values, ascending.
    """
    edges = [float(e) for e in edges]
    if len(edges) < 2:
        raise ValueError("edges must contain at least two boundaries")
    if any(b <= a for a, b in zip(edges, edges[1:])):
        raise ValueError("edges must be strictly increasing")

    k = len(edges) - 1
    valid = build_valid_mask(
        plane,
        mask=mask,
        alpha=alpha,
        ignore_transparent=ignore_transparent,
        exclude_zero=exclude_zero,
        value_min=edges[0],
        value_max=edges[-1],
    )
    values = np.asarray(plane)[valid].astype(np.float64)
    total = int(values.size)

    if total == 0:
        return [
            {
                "index": i, "lower": edges[i], "upper": edges[i + 1],
                "count": 0, "count_pct": 0.0,
                "mean": None, "std": None, "min": None, "max": None,
            }
            for i in range(k)
        ]

    idx = np.clip(np.digitize(values, np.asarray(edges[1:-1]), right=False), 0, k - 1)
    counts = np.bincount(idx, minlength=k).astype(np.int64)
    sums = np.bincount(idx, weights=values, minlength=k)
    sumsqs = np.bincount(idx, weights=values * values, minlength=k)

    out = []
    for i in range(k):
        n = int(counts[i])
        if n == 0:
            out.append({
                "index": i, "lower": edges[i], "upper": edges[i + 1],
                "count": 0, "count_pct": 0.0,
                "mean": None, "std": None, "min": None, "max": None,
            })
            continue
        mean = sums[i] / n
        var = max(0.0, sumsqs[i] / n - mean * mean)
        sel = values[idx == i]
        out.append({
            "index": i,
            "lower": edges[i],
            "upper": edges[i + 1],
            "count": n,
            "count_pct": n / total * 100.0,
            "mean": float(mean),
            "std": float(math.sqrt(var)),
            "min": float(sel.min()),
            "max": float(sel.max()),
        })
    return out


# ---------------------------------------------------------------------------
# Transport: bin-code plane
# ---------------------------------------------------------------------------


def quantize_to_bins(
    plane: np.ndarray,
    bins: int,
    value_min: float,
    value_max: float,
    mask=None,
    alpha=None,
    ignore_transparent: bool = False,
    exclude_zero: bool = False,
) -> np.ndarray:
    """
    Encode *plane* as ``uint16`` bin codes, using code ``bins`` for no-data.

    The browser paints by indexing a ``bins + 1`` entry colour table with these
    codes, so the rendered image cannot disagree with the level table.
    """
    if bins > 65534:
        raise ValueError("bins must be <= 65534 to fit a uint16 no-data code")
    if not (value_max > value_min):
        value_max = value_min + 1.0

    plane = np.asarray(plane)
    codes = np.full(plane.shape, bins, dtype=np.uint16)
    valid = build_valid_mask(
        plane,
        mask=mask,
        alpha=alpha,
        ignore_transparent=ignore_transparent,
        exclude_zero=exclude_zero,
        value_min=value_min,
        value_max=value_max,
    )
    if valid.any():
        vals = plane[valid].astype(np.float64)
        codes[valid] = _bin_indices(vals, bins, value_min, value_max).astype(np.uint16)
    return codes


def downsample_plane(plane: np.ndarray, max_dim: int) -> tuple[np.ndarray, int]:
    """
    Decimate *plane* so its longest side is at most *max_dim*.

    Strided subsampling, never averaging: averaging bin codes across a level
    boundary would invent an intermediate level that does not exist in the
    image.
    """
    plane = np.asarray(plane)
    longest = max(plane.shape[:2])
    if max_dim <= 0 or longest <= max_dim:
        return plane, 1
    factor = int(math.ceil(longest / max_dim))
    return plane[::factor, ::factor], factor
