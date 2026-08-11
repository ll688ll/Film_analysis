"""General image-analysis endpoints: upload, histogram, level map, statistics.

Unlike :mod:`app.routers.analysis` this path is not film-specific -- it needs
no calibration profile and accepts any image Pillow can decode.

Division of labour with the browser: this router computes the augmented
histogram once at full resolution, and the client derives every per-level
statistic from it via prefix sums. Dragging a threshold or recolouring a level
therefore costs no network round-trip. See :mod:`app.services.intensity`.
"""

from __future__ import annotations

import io
from typing import Literal

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.dependencies import get_current_user
from app.models import User
from app.services.film_analyzer import build_roi_mask
from app.services.image_io import load_image_general
from app.services.intensity import (
    MAX_BINS,
    MAX_LEVELS,
    MIN_BINS,
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
from app.services.session_cache import get_cache_entry, put_cache_entry, save_upload

router = APIRouter(prefix="/imaging", tags=["imaging"])

#: Broader than the film path's set -- this page analyses arbitrary images.
IMAGE_EXTENSIONS = {
    ".tif", ".tiff", ".png", ".jpg", ".jpeg",
    ".bmp", ".gif", ".webp", ".tga", ".ppm", ".pgm",
}

#: Longest side of the transported bin-code plane. Statistics are always
#: computed at full resolution regardless of this.
DEFAULT_MAX_DIM = 2048

IntensitySourceName = Literal["Gray", "Mean", "Red", "Green", "Blue"]

PLANE_HEADERS = [
    "X-Width", "X-Height",
    "X-Int-Bins", "X-Int-Min", "X-Int-Max", "X-Int-Source",
    "X-Int-Format", "X-Int-Downsample", "X-Int-Nodata", "X-Int-Nan-Count",
]


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------

class ROISpec(BaseModel):
    roi_type: Literal["Rectangle", "Circle", "Ring"] = "Rectangle"
    x: float
    y: float
    w: float
    h: float
    rotation_deg: float = 0
    hole_ratio: float = 50


class AnalyzeRequest(BaseModel):
    source: IntensitySourceName = "Gray"
    bins: int = Field(default=256, ge=MIN_BINS, le=MAX_BINS)
    value_min: float | None = None
    value_max: float | None = None
    exclude_zero: bool = False
    ignore_transparent: bool = False
    roi: ROISpec | None = None


class ThresholdsRequest(AnalyzeRequest):
    levels: int = Field(default=4, ge=2, le=MAX_LEVELS)
    method: Literal["equal_width", "equal_count", "otsu", "kmeans"] = "otsu"


class LevelStatsRequest(BaseModel):
    source: IntensitySourceName = "Gray"
    edges: list[float] = Field(min_length=2, max_length=MAX_LEVELS + 1)
    exclude_zero: bool = False
    ignore_transparent: bool = False
    roi: ROISpec | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _plane_for(entry: dict, source: str) -> np.ndarray:
    """Extract the intensity plane, mapping unsupported sources to a 400."""
    try:
        return extract_intensity_plane(entry["image_array"], source)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc


def _roi_mask(entry: dict, roi: ROISpec | None) -> np.ndarray | None:
    if roi is None:
        return None
    shape = entry["image_array"].shape[:2]
    return build_roi_mask(
        shape,
        roi.roi_type,
        roi.x, roi.y, roi.w, roi.h,
        rotation_deg=roi.rotation_deg,
        hole_ratio=roi.hole_ratio,
    )


#: Small LRU of recent histograms per session. Sized so the main analysis and
#: the three RGB-chart histograms coexist without evicting each other.
_HIST_CACHE_SIZE = 6


def _histogram_for(entry: dict, body: AnalyzeRequest) -> tuple[np.ndarray, dict]:
    """Compute (or reuse a cached) histogram for the given request."""
    plane = _plane_for(entry, body.source)
    key = (
        body.source, body.bins, body.value_min, body.value_max,
        body.exclude_zero, body.ignore_transparent,
        None if body.roi is None else body.roi.model_dump_json(),
    )

    cache: list = entry.setdefault("intensity_hist", [])
    for i, (cached_key, cached_hist) in enumerate(cache):
        if cached_key == key:
            cache.append(cache.pop(i))  # refresh recency
            return plane, cached_hist

    hist = compute_histogram(
        plane,
        bins=body.bins,
        value_min=body.value_min,
        value_max=body.value_max,
        mask=_roi_mask(entry, body.roi),
        alpha=entry.get("alpha"),
        ignore_transparent=body.ignore_transparent,
        exclude_zero=body.exclude_zero,
    )
    cache.append((key, hist))
    del cache[:-_HIST_CACHE_SIZE]
    return plane, hist


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/upload")
async def upload_image(
    file: UploadFile,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    """Accept any decodable image and open an analysis session for it."""
    session_id, save_path = await save_upload(
        file, current_user.id, IMAGE_EXTENSIONS, subdir="imaging"
    )

    try:
        loaded = load_image_general(str(save_path))
    except ValueError as exc:
        save_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc

    put_cache_entry(
        request,
        session_id,
        image_array=loaded.array,
        dpi=loaded.dpi,
        file_path=str(save_path),
        user_id=current_user.id,
        alpha=loaded.alpha,
        has_dpi=loaded.has_dpi,
    )

    dtype_name, max_possible = dtype_info(loaded.array, arr_max=float(loaded.array.max()))

    return {
        "session_id": session_id,
        "filename": file.filename,
        "dtype": dtype_name,
        "max_possible": max_possible,
        **loaded.as_meta(),
    }


@router.post("/{session_id}/analyze")
async def analyze(
    session_id: str,
    body: AnalyzeRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    """Full-resolution augmented histogram plus overall statistics."""
    entry = get_cache_entry(request, session_id, current_user.id)
    image_array = entry["image_array"]
    _plane, hist = _histogram_for(entry, body)

    height, width = image_array.shape[:2]
    dtype_name, max_possible = dtype_info(image_array, arr_max=float(image_array.max()))

    return {
        "session_id": session_id,
        "source": body.source,
        "width": width,
        "height": height,
        "channels": 1 if image_array.ndim == 2 else image_array.shape[2],
        "dtype": dtype_name,
        "max_possible": max_possible,
        "dpi": entry["dpi"],
        "has_dpi": bool(entry.get("has_dpi", False)),
        "has_alpha": entry.get("alpha") is not None,
        **hist,
    }


@router.get("/{session_id}/plane")
async def intensity_plane(
    session_id: str,
    request: Request,
    source: IntensitySourceName = "Gray",
    bins: int = Query(default=256, ge=MIN_BINS, le=MAX_BINS),
    value_min: float | None = None,
    value_max: float | None = None,
    exclude_zero: bool = False,
    ignore_transparent: bool = False,
    max_dim: int = Query(default=DEFAULT_MAX_DIM, ge=64, le=16384),
    current_user: User = Depends(get_current_user),
):
    """
    Raw ``uint16`` bin codes, one per pixel, for client-side painting.

    The caller must pass back the ``bins`` / ``value_min`` / ``value_max`` it
    received from ``/analyze``: identical binning is what guarantees the
    painted map and the statistics table agree.
    """
    entry = get_cache_entry(request, session_id, current_user.id)
    plane = _plane_for(entry, source)

    if value_min is not None and value_max is not None:
        # The caller echoed back /analyze's resolved window, so no histogram
        # is needed -- and recomputing one here (without the ROI) would only
        # churn the cache.
        vmin, vmax = float(value_min), float(value_max)
        if not (vmax > vmin):
            vmax = vmin + 1.0
        nan_count = int(np.count_nonzero(~np.isfinite(plane)))
    else:
        # Resolve the window the same way compute_histogram does, so an
        # omitted window still lands on identical bin edges.
        body = AnalyzeRequest(
            source=source, bins=bins, value_min=value_min, value_max=value_max,
            exclude_zero=exclude_zero, ignore_transparent=ignore_transparent,
        )
        _p, hist = _histogram_for(entry, body)
        vmin, vmax = hist["value_min"], hist["value_max"]
        nan_count = hist["excluded_nonfinite"]

    alpha = entry.get("alpha")
    small, factor = downsample_plane(plane, max_dim)
    small_alpha = alpha[::factor, ::factor] if alpha is not None and factor > 1 else alpha

    codes = quantize_to_bins(
        small,
        bins,
        vmin,
        vmax,
        alpha=small_alpha,
        ignore_transparent=ignore_transparent,
        exclude_zero=exclude_zero,
    )
    if not codes.flags["C_CONTIGUOUS"]:
        codes = np.ascontiguousarray(codes)

    height, width = codes.shape
    headers = {
        "X-Width": str(width),
        "X-Height": str(height),
        "X-Int-Bins": str(bins),
        "X-Int-Min": repr(vmin),
        "X-Int-Max": repr(vmax),
        "X-Int-Source": source,
        "X-Int-Format": "u16-bins",
        "X-Int-Downsample": str(factor),
        "X-Int-Nodata": str(bins),
        "X-Int-Nan-Count": str(nan_count),
        # Also set inline: dev goes through the Vite proxy, so a missing
        # entry in the CORS middleware would only surface in production.
        "Access-Control-Expose-Headers": ", ".join(PLANE_HEADERS),
    }
    return StreamingResponse(
        io.BytesIO(codes.tobytes()),
        media_type="application/octet-stream",
        headers=headers,
    )


@router.post("/{session_id}/thresholds")
async def thresholds(
    session_id: str,
    body: ThresholdsRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    """Automatic level boundaries, as both bin indices and values."""
    entry = get_cache_entry(request, session_id, current_user.id)
    _plane, hist = _histogram_for(entry, body)

    counts = np.asarray(hist["counts"], dtype=np.float64)
    sums = np.asarray(hist["sums"], dtype=np.float64)
    bin_width = hist["bin_width"]
    centers = hist["value_min"] + (np.arange(hist["bins"]) + 0.5) * bin_width

    if body.method == "equal_width":
        edge_bins = equal_width_edges(hist["bins"], body.levels)
    elif body.method == "equal_count":
        edge_bins = equal_count_edges(counts, body.levels)
    elif body.method == "kmeans":
        edge_bins = kmeans_1d_thresholds(counts, centers, body.levels)
    else:
        edge_bins = multi_otsu_thresholds(counts, sums, body.levels)

    bounds = [0, *edge_bins, hist["bins"]]
    return {
        "method": body.method,
        "levels": len(bounds) - 1,
        "requested_levels": body.levels,
        "edge_bins": edge_bins,
        "bound_bins": bounds,
        "edges": [hist["value_min"] + b * bin_width for b in bounds],
        "bins": hist["bins"],
        "value_min": hist["value_min"],
        "value_max": hist["value_max"],
        "bin_width": bin_width,
    }


@router.post("/{session_id}/level-stats")
async def exact_level_stats(
    session_id: str,
    body: LevelStatsRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    """
    Per-level statistics computed directly from the full-resolution plane.

    The client derives the same numbers from the histogram; this endpoint is
    the authoritative cross-check.
    """
    entry = get_cache_entry(request, session_id, current_user.id)
    plane = _plane_for(entry, body.source)

    try:
        stats = level_stats(
            plane,
            body.edges,
            mask=_roi_mask(entry, body.roi),
            alpha=entry.get("alpha"),
            ignore_transparent=body.ignore_transparent,
            exclude_zero=body.exclude_zero,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc

    total = sum(s["count"] for s in stats)
    return {
        "session_id": session_id,
        "source": body.source,
        "levels": stats,
        "total_count": total,
        "dpi": entry["dpi"],
        "has_dpi": bool(entry.get("has_dpi", False)),
    }
