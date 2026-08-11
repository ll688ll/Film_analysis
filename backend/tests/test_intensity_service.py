"""Tests for the intensity-analysis numpy layer (app.services.intensity)."""

import itertools
import math

import numpy as np
import pytest

from app.services.intensity import (
    compute_histogram,
    downsample_plane,
    dtype_info,
    equal_count_edges,
    equal_width_edges,
    extract_intensity_plane,
    kmeans_1d_thresholds,
    level_stats,
    multi_otsu_thresholds,
    quantize_to_bins,
)


# ---------------------------------------------------------------------------
# Helpers mirroring the client-side prefix-sum derivation
# ---------------------------------------------------------------------------

def _prefix(hist):
    return (
        np.concatenate(([0.0], np.cumsum(hist["counts"]))),
        np.concatenate(([0.0], np.cumsum(hist["sums"]))),
        np.concatenate(([0.0], np.cumsum(hist["sumsqs"]))),
    )


def _derive(hist, lo_bin, hi_bin):
    """Replicate exactly what intensityStats.ts does in the browser."""
    c0, c1, c2 = _prefix(hist)
    n = c0[hi_bin + 1] - c0[lo_bin]
    if n == 0:
        return {"count": 0, "mean": None, "std": None}
    s = c1[hi_bin + 1] - c1[lo_bin]
    q = c2[hi_bin + 1] - c2[lo_bin]
    mean = s / n
    var = max(0.0, q / n - mean * mean)
    return {"count": int(n), "mean": mean, "std": math.sqrt(var)}


def _bin_to_value(hist, b):
    return hist["value_min"] + b * hist["bin_width"]


# ---------------------------------------------------------------------------
# dtype_info
# ---------------------------------------------------------------------------


class TestDtypeInfo:
    def test_uint8(self):
        assert dtype_info(np.zeros((2, 2), np.uint8)) == ("uint8", 255.0)

    def test_uint16(self):
        assert dtype_info(np.zeros((2, 2), np.uint16)) == ("uint16", 65535.0)

    def test_float_has_no_full_scale(self):
        name, mx = dtype_info(np.zeros((2, 2), np.float32))
        assert name == "float" and mx is None

    def test_int32_from_pil_mode_I_treated_as_16bit(self):
        """PIL returns mode-I 16-bit TIFFs as int32; observed max disambiguates."""
        assert dtype_info(np.zeros((2, 2), np.int32), arr_max=40000) == (
            "uint16", 65535.0,
        )

    def test_int32_with_large_values_stays_int32(self):
        name, mx = dtype_info(np.zeros((2, 2), np.int32), arr_max=2_000_000)
        assert name == "int32" and mx == float(np.iinfo(np.int32).max)


# ---------------------------------------------------------------------------
# extract_intensity_plane
# ---------------------------------------------------------------------------


class TestExtractIntensityPlane:
    def test_grayscale_passthrough(self):
        arr = np.arange(12, dtype=np.uint8).reshape(3, 4)
        out = extract_intensity_plane(arr, "Gray")
        assert out.shape == (3, 4)
        assert out.dtype == np.float32
        np.testing.assert_array_equal(out, arr.astype(np.float32))

    def test_red_picks_channel_zero(self):
        arr = np.zeros((2, 2, 3), np.uint8)
        arr[..., 0] = 200
        arr[..., 1] = 50
        assert extract_intensity_plane(arr, "Red").mean() == pytest.approx(200)
        assert extract_intensity_plane(arr, "Green").mean() == pytest.approx(50)
        assert extract_intensity_plane(arr, "Blue").mean() == pytest.approx(0)

    def test_gray_uses_rec601_luma(self):
        arr = np.zeros((1, 1, 3), np.uint8)
        arr[0, 0] = (255, 0, 0)
        assert extract_intensity_plane(arr, "Gray")[0, 0] == pytest.approx(76.245)

    def test_mean_of_channels(self):
        arr = np.zeros((1, 1, 3), np.uint8)
        arr[0, 0] = (0, 128, 255)
        assert extract_intensity_plane(arr, "Mean")[0, 0] == pytest.approx(127.6667, abs=1e-3)

    def test_rgba_alpha_excluded_from_value(self):
        rgba = np.zeros((1, 1, 4), np.uint8)
        rgba[0, 0] = (10, 20, 30, 255)
        rgb = rgba[:, :, :3]
        assert extract_intensity_plane(rgba, "Mean")[0, 0] == pytest.approx(
            extract_intensity_plane(rgb, "Mean")[0, 0]
        )

    def test_no_255_normalisation_for_uint16(self):
        """The dosimetry path divides by 255; the intensity path must not."""
        arr = np.full((2, 2), 40000, np.uint16)
        assert extract_intensity_plane(arr, "Gray").max() == pytest.approx(40000)

    def test_uint16_luma_keeps_precision(self):
        arr = np.zeros((1, 1, 3), np.uint16)
        arr[0, 0] = (60000, 60000, 60000)
        assert extract_intensity_plane(arr, "Gray")[0, 0] == pytest.approx(60000, rel=1e-5)

    def test_colour_channel_on_grayscale_raises(self):
        with pytest.raises(ValueError, match="grayscale"):
            extract_intensity_plane(np.zeros((4, 4), np.uint8), "Red")

    def test_colour_channel_on_la_raises(self):
        with pytest.raises(ValueError, match="channel"):
            extract_intensity_plane(np.zeros((4, 4, 2), np.uint8), "Blue")

    def test_la_gray_uses_channel_zero(self):
        arr = np.zeros((2, 2, 2), np.uint8)
        arr[..., 0] = 77
        arr[..., 1] = 3
        assert extract_intensity_plane(arr, "Gray").mean() == pytest.approx(77)

    def test_unknown_source_raises(self):
        with pytest.raises(ValueError, match="Unknown intensity source"):
            extract_intensity_plane(np.zeros((2, 2), np.uint8), "Cyan")


# ---------------------------------------------------------------------------
# compute_histogram
# ---------------------------------------------------------------------------


class TestComputeHistogram:
    def test_counts_sum_to_total(self):
        plane = np.random.randint(0, 256, (40, 50)).astype(np.float32)
        h = compute_histogram(plane, bins=256)
        assert sum(h["counts"]) == h["total_count"] == 40 * 50

    def test_identity_histogram(self):
        """0..255 exactly once each at 256 bins gives one pixel per bin."""
        plane = np.arange(256, dtype=np.float32).reshape(16, 16)
        h = compute_histogram(plane, bins=256, value_min=0, value_max=256)
        assert h["counts"] == [1] * 256
        assert h["sums"] == [float(i) for i in range(256)]
        assert h["sumsqs"] == [float(i * i) for i in range(256)]

    def test_constant_image_does_not_divide_by_zero(self):
        plane = np.full((10, 10), 42.0, np.float32)
        h = compute_histogram(plane, bins=64)
        assert h["value_max"] > h["value_min"]
        assert sum(h["counts"]) == 100
        assert h["counts"][0] == 100
        assert h["overall"]["mean"] == pytest.approx(42.0)

    def test_nonfinite_excluded_and_counted(self):
        plane = np.arange(100, dtype=np.float32).reshape(10, 10)
        plane[0, 0] = np.nan
        plane[0, 1] = np.inf
        h = compute_histogram(plane, bins=32)
        assert h["excluded_nonfinite"] == 2
        assert h["total_count"] == 98
        assert sum(h["counts"]) == 98

    def test_mask_restricts_population(self):
        plane = np.arange(100, dtype=np.float32).reshape(10, 10)
        mask = np.zeros((10, 10), bool)
        mask[:5] = True
        h = compute_histogram(plane, bins=32, mask=mask)
        assert h["total_count"] == 50

    def test_window_excludes_rather_than_clamps(self):
        plane = np.arange(100, dtype=np.float32).reshape(10, 10)
        h = compute_histogram(plane, bins=16, value_min=20, value_max=79)
        assert h["excluded_low"] == 20
        assert h["excluded_high"] == 20
        assert h["total_count"] == 60
        # Excluding means every reported value really is inside the window
        assert h["overall"]["min"] >= 20
        assert h["overall"]["max"] <= 79

    def test_data_range_is_reported_unwindowed(self):
        plane = np.arange(100, dtype=np.float32).reshape(10, 10)
        h = compute_histogram(plane, bins=16, value_min=20, value_max=79)
        assert h["data_min"] == 0.0
        assert h["data_max"] == 99.0

    def test_exclude_zero(self):
        plane = np.zeros((10, 10), np.float32)
        plane[:2] = 100.0
        h = compute_histogram(plane, bins=32, exclude_zero=True)
        assert h["total_count"] == 20
        assert h["overall"]["mean"] == pytest.approx(100.0)

    def test_ignore_transparent(self):
        plane = np.full((10, 10), 50.0, np.float32)
        alpha = np.full((10, 10), 255, np.uint8)
        alpha[:4] = 0
        h = compute_histogram(plane, bins=32, alpha=alpha, ignore_transparent=True)
        assert h["total_count"] == 60

    def test_alpha_ignored_unless_requested(self):
        plane = np.full((10, 10), 50.0, np.float32)
        alpha = np.zeros((10, 10), np.uint8)
        h = compute_histogram(plane, bins=32, alpha=alpha, ignore_transparent=False)
        assert h["total_count"] == 100

    def test_all_pixels_excluded_is_safe(self):
        plane = np.zeros((5, 5), np.float32)
        h = compute_histogram(plane, bins=16, exclude_zero=True)
        assert h["total_count"] == 0
        assert h["overall"]["mean"] is None
        assert sum(h["counts"]) == 0

    def test_rejects_out_of_range_bins(self):
        plane = np.zeros((4, 4), np.float32)
        with pytest.raises(ValueError):
            compute_histogram(plane, bins=8)
        with pytest.raises(ValueError):
            compute_histogram(plane, bins=99999)


# ---------------------------------------------------------------------------
# The load-bearing test: client-side derivation must be exact
# ---------------------------------------------------------------------------


class TestHistogramDerivedStatsMatchDirect:
    """
    Validates the whole client-side-derivation architecture.

    If these fail, the browser's level table is lying and every number the
    page reports is suspect.
    """

    def test_uint8_source_is_exact(self):
        rng = np.random.default_rng(1234)
        arr = rng.integers(0, 256, (120, 160)).astype(np.uint8)
        plane = extract_intensity_plane(arr, "Gray")
        h = compute_histogram(plane, bins=256, value_min=0, value_max=256)

        for lo_bin, hi_bin in [(0, 63), (64, 127), (10, 10), (0, 255), (200, 240)]:
            lo = _bin_to_value(h, lo_bin)
            hi = _bin_to_value(h, hi_bin + 1)
            direct = plane[(plane >= lo) & (plane < hi)].astype(np.float64)
            got = _derive(h, lo_bin, hi_bin)

            assert got["count"] == direct.size, f"count for bins {lo_bin}-{hi_bin}"
            assert got["mean"] == pytest.approx(direct.mean(), rel=1e-12)
            assert got["std"] == pytest.approx(direct.std(), abs=1e-9)

    def test_float_gray_source_is_exact(self):
        """
        The case a bin-index-only derivation would get wrong.

        Rec.601 luma produces non-integer values, so the mean must come from
        the per-bin sums rather than from bin midpoints.
        """
        rng = np.random.default_rng(99)
        arr = rng.integers(0, 256, (90, 110, 3)).astype(np.uint8)
        plane = extract_intensity_plane(arr, "Gray")
        h = compute_histogram(plane, bins=512)

        for lo_bin, hi_bin in [(0, 100), (101, 300), (301, 511), (250, 250)]:
            lo = _bin_to_value(h, lo_bin)
            hi = _bin_to_value(h, hi_bin + 1)
            sel = (plane >= lo) & (plane < hi)
            if hi_bin == h["bins"] - 1:
                sel |= plane == h["value_max"]  # last bin is right-inclusive
            direct = plane[sel].astype(np.float64)
            got = _derive(h, lo_bin, hi_bin)

            assert got["count"] == direct.size
            assert got["mean"] == pytest.approx(direct.mean(), rel=1e-10)
            assert got["std"] == pytest.approx(direct.std(), abs=1e-7)

    def test_derivation_matches_level_stats_oracle(self):
        rng = np.random.default_rng(7)
        plane = rng.normal(128, 40, (100, 100)).astype(np.float32)
        h = compute_histogram(plane, bins=256)

        edge_bins = equal_width_edges(h["bins"], 4)
        bounds = [0] + edge_bins + [h["bins"]]
        edges = [_bin_to_value(h, b) for b in bounds]

        exact = level_stats(plane, edges)
        for i, stat in enumerate(exact):
            got = _derive(h, bounds[i], bounds[i + 1] - 1)
            assert got["count"] == stat["count"], f"level {i}"
            if stat["count"]:
                assert got["mean"] == pytest.approx(stat["mean"], rel=1e-10)
                assert got["std"] == pytest.approx(stat["std"], abs=1e-7)


# ---------------------------------------------------------------------------
# Thresholding
# ---------------------------------------------------------------------------


def _synthetic_hist(peaks, bins=256, spread=6, n=4000):
    rng = np.random.default_rng(0)
    vals = np.concatenate([rng.normal(p, spread, n) for p in peaks])
    vals = np.clip(vals, 0, bins - 1)
    counts = np.bincount(vals.astype(int), minlength=bins).astype(np.float64)
    centers = np.arange(bins) + 0.5
    sums = counts * centers
    return counts, sums, centers


class TestMultiOtsu:
    def test_bimodal_threshold_lands_between_peaks(self):
        counts, sums, _ = _synthetic_hist([60, 190])
        edges = multi_otsu_thresholds(counts, sums, 2)
        assert len(edges) == 1
        assert 100 < edges[0] < 160

    def test_trimodal(self):
        counts, sums, _ = _synthetic_hist([40, 128, 215])
        edges = multi_otsu_thresholds(counts, sums, 3)
        assert len(edges) == 2
        assert edges[0] < edges[1]
        assert 60 < edges[0] < 110
        assert 150 < edges[1] < 200

    def test_dp_matches_brute_force(self):
        """The DP must find the true optimum, not a local one."""
        rng = np.random.default_rng(5)
        bins = 32
        counts = rng.integers(0, 50, bins).astype(np.float64)
        centers = np.arange(bins) + 0.5
        sums = counts * centers

        got = multi_otsu_thresholds(counts, sums, 3)

        p0 = np.concatenate(([0.0], np.cumsum(counts)))
        p1 = np.concatenate(([0.0], np.cumsum(sums)))

        def total(bounds):
            score = 0.0
            for a, b in zip(bounds, bounds[1:]):
                n = p0[b] - p0[a]
                if n > 0:
                    score += (p1[b] - p1[a]) ** 2 / n
            return score

        best = max(
            itertools.combinations(range(1, bins), 2),
            key=lambda c: total([0, c[0], c[1], bins]),
        )
        assert total([0, *got, bins]) == pytest.approx(total([0, *best, bins]))

    def test_thresholds_strictly_increasing(self):
        counts, sums, _ = _synthetic_hist([30, 80, 130, 180, 230])
        edges = multi_otsu_thresholds(counts, sums, 5)
        assert edges == sorted(set(edges))
        assert len(edges) == 4

    def test_k_of_one_returns_empty(self):
        counts, sums, _ = _synthetic_hist([100])
        assert multi_otsu_thresholds(counts, sums, 1) == []

    def test_empty_histogram_returns_empty(self):
        assert multi_otsu_thresholds(np.zeros(64), np.zeros(64), 3) == []

    def test_more_levels_than_distinct_values_does_not_crash(self):
        counts = np.zeros(64)
        counts[10] = 100
        counts[40] = 100
        sums = counts * (np.arange(64) + 0.5)
        edges = multi_otsu_thresholds(counts, sums, 8)
        assert edges == sorted(set(edges))
        assert all(1 <= e < 64 for e in edges)

    def test_large_bin_count_uses_rebinning(self):
        counts, sums, _ = _synthetic_hist([500, 1500, 3000], bins=2048, spread=40)
        edges = multi_otsu_thresholds(counts, sums, 3)
        assert len(edges) == 2
        assert all(0 < e < 2048 for e in edges)
        assert edges[0] < edges[1]


class TestKMeans1D:
    def test_bimodal(self):
        counts, _, centers = _synthetic_hist([50, 200])
        edges = kmeans_1d_thresholds(counts, centers, 2)
        assert len(edges) == 1
        assert 90 < edges[0] < 170

    def test_k_of_one_returns_empty(self):
        counts, _, centers = _synthetic_hist([100])
        assert kmeans_1d_thresholds(counts, centers, 1) == []

    def test_strictly_increasing(self):
        counts, _, centers = _synthetic_hist([20, 90, 160, 230])
        edges = kmeans_1d_thresholds(counts, centers, 4)
        assert edges == sorted(set(edges))


class TestSimpleEdges:
    def test_equal_width(self):
        assert equal_width_edges(256, 4) == [64, 128, 192]

    def test_equal_width_non_divisible(self):
        edges = equal_width_edges(100, 3)
        assert len(edges) == 2 and edges == sorted(set(edges))

    def test_equal_count_on_uniform_histogram(self):
        counts = np.ones(256)
        edges = equal_count_edges(counts, 4)
        assert edges == [64, 128, 192]

    def test_equal_count_empty_histogram(self):
        assert equal_count_edges(np.zeros(64), 4) == []

    def test_equal_count_centres_in_empty_gaps(self):
        """
        Four spikes with empty gaps: any boundary inside a gap gives identical
        populations, so the reported edge should be the gap's midpoint rather
        than the bin just past the lower spike. Mirrored client-side in
        intensityStats.ts::centerInEmptyRun -- the two must agree or switching
        methods would visibly shift the boundaries.
        """
        counts = np.zeros(256)
        for v in (32, 96, 160, 224):
            counts[v] = 10000
        assert equal_count_edges(counts, 4) == [64, 128, 192]

    def test_equal_count_matches_equal_width_on_evenly_spaced_spikes(self):
        counts = np.zeros(256)
        for v in (32, 96, 160, 224):
            counts[v] = 10000
        assert equal_count_edges(counts, 4) == equal_width_edges(256, 4)

    def test_equal_count_still_balances_a_dense_histogram(self):
        counts = np.ones(256) * 10
        edges = equal_count_edges(counts, 4)
        assert edges == [64, 128, 192]


# ---------------------------------------------------------------------------
# level_stats
# ---------------------------------------------------------------------------


class TestLevelStats:
    def test_four_quadrants_are_exactly_quarters(self):
        """The synthetic image from the manual checklist, as an assertion."""
        plane = np.zeros((100, 100), np.float32)
        plane[:50, :50] = 32
        plane[:50, 50:] = 96
        plane[50:, :50] = 160
        plane[50:, 50:] = 224

        stats = level_stats(plane, [0, 64, 128, 192, 256])
        assert [s["count"] for s in stats] == [2500] * 4
        assert [round(s["count_pct"], 6) for s in stats] == [25.0] * 4
        assert [s["mean"] for s in stats] == [32, 96, 160, 224]
        assert all(s["std"] == pytest.approx(0.0) for s in stats)

    def test_percentages_sum_to_100(self):
        rng = np.random.default_rng(3)
        plane = rng.uniform(0, 255, (60, 60)).astype(np.float32)
        stats = level_stats(plane, [0, 50, 100, 150, 200, 255])
        assert sum(s["count_pct"] for s in stats) == pytest.approx(100.0)

    def test_empty_level_reports_none_not_nan(self):
        plane = np.full((10, 10), 10.0, np.float32)
        stats = level_stats(plane, [0, 20, 40, 60])
        assert stats[0]["count"] == 100
        assert stats[1]["count"] == 0
        assert stats[1]["mean"] is None
        assert stats[1]["std"] is None

    def test_boundary_value_lands_in_upper_level(self):
        plane = np.full((4, 4), 50.0, np.float32)
        stats = level_stats(plane, [0, 50, 100])
        assert stats[0]["count"] == 0
        assert stats[1]["count"] == 16

    def test_top_edge_is_inclusive(self):
        plane = np.full((4, 4), 100.0, np.float32)
        stats = level_stats(plane, [0, 50, 100])
        assert stats[1]["count"] == 16

    def test_values_outside_edges_are_excluded(self):
        plane = np.arange(100, dtype=np.float32).reshape(10, 10)
        stats = level_stats(plane, [20, 50, 80])
        assert sum(s["count"] for s in stats) == 61  # 20..80 inclusive

    def test_requires_increasing_edges(self):
        plane = np.zeros((4, 4), np.float32)
        with pytest.raises(ValueError, match="increasing"):
            level_stats(plane, [0, 100, 50])

    def test_requires_two_edges(self):
        with pytest.raises(ValueError):
            level_stats(np.zeros((4, 4), np.float32), [0])

    def test_respects_mask(self):
        plane = np.full((10, 10), 30.0, np.float32)
        mask = np.zeros((10, 10), bool)
        mask[:3] = True
        stats = level_stats(plane, [0, 64], mask=mask)
        assert stats[0]["count"] == 30


# ---------------------------------------------------------------------------
# Transport
# ---------------------------------------------------------------------------


class TestQuantizeToBins:
    def test_codes_within_range(self):
        plane = np.random.uniform(0, 255, (30, 40)).astype(np.float32)
        codes = quantize_to_bins(plane, 256, 0, 255)
        assert codes.dtype == np.uint16
        assert codes.max() <= 256

    def test_nonfinite_gets_nodata_code(self):
        plane = np.zeros((4, 4), np.float32)
        plane[0, 0] = np.nan
        codes = quantize_to_bins(plane, 64, 0, 255)
        assert codes[0, 0] == 64
        assert codes[1, 1] == 0

    def test_out_of_window_gets_nodata_code(self):
        plane = np.array([[10.0, 50.0, 200.0]], np.float32)
        codes = quantize_to_bins(plane, 64, 20, 100)
        assert codes[0, 0] == 64  # below window
        assert codes[0, 2] == 64  # above window
        assert codes[0, 1] < 64

    def test_transparent_gets_nodata_code(self):
        plane = np.full((2, 2), 50.0, np.float32)
        alpha = np.array([[0, 255], [255, 255]], np.uint8)
        codes = quantize_to_bins(
            plane, 32, 0, 255, alpha=alpha, ignore_transparent=True
        )
        assert codes[0, 0] == 32
        assert codes[0, 1] < 32

    def test_codes_agree_with_histogram_bins(self):
        """The rendered map and the level table must index the same bins."""
        rng = np.random.default_rng(11)
        plane = rng.uniform(0, 255, (50, 50)).astype(np.float32)
        h = compute_histogram(plane, bins=128)
        codes = quantize_to_bins(plane, 128, h["value_min"], h["value_max"])

        code_counts = np.bincount(codes.ravel(), minlength=129)[:128]
        np.testing.assert_array_equal(code_counts, np.array(h["counts"]))

    def test_rejects_too_many_bins(self):
        with pytest.raises(ValueError, match="uint16"):
            quantize_to_bins(np.zeros((2, 2), np.float32), 70000, 0, 1)


class TestDownsamplePlane:
    def test_no_downsample_when_small(self):
        plane = np.zeros((100, 80), np.float32)
        out, factor = downsample_plane(plane, 2048)
        assert factor == 1 and out.shape == (100, 80)

    def test_decimates_to_within_limit(self):
        plane = np.zeros((5000, 3000), np.float32)
        out, factor = downsample_plane(plane, 1000)
        assert factor == 5
        assert max(out.shape) <= 1000

    def test_preserves_exact_values(self):
        """Subsampling, not averaging: no invented intermediate values."""
        plane = np.array([[0, 255], [255, 0]] * 4, np.float32)
        out, _ = downsample_plane(plane, 2)
        assert set(np.unique(out).tolist()) <= {0.0, 255.0}
