"""Film analysis endpoints: upload, preview, calibrate, ROI, save, export."""

from __future__ import annotations

import io
import math
import uuid
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user
from app.models import (
    AnalysisSession,
    CalibrationProfile,
    ChannelParams,
    ROIMeasurement,
    User,
)
from app.routers.projects import get_user_project
from app.services.analysis_files import delete_owned_file, own_file
from app.services.film_analyzer import FilmAnalyzer, build_roi_mask
from app.services.image_io import read_dpi
from app.services.image_utils import (
    generate_dose_map_preview,
    generate_preview,
    load_image,
)
from app.services.session_cache import (
    get_cache_entry,
    put_cache_entry,
    save_upload,
)

router = APIRouter(prefix="/analysis", tags=["analysis"])

ALLOWED_EXTENSIONS = {".tif", ".tiff", ".png", ".jpg", ".jpeg"}


# ---------------------------------------------------------------------------
# Request / response bodies
# ---------------------------------------------------------------------------

class CalibrateRequest(BaseModel):
    profile_id: int | None = None
    channel: str = "Red"
    a: float
    b: float
    c: float
    cmap_min: float | None = None
    cmap_max: float | None = None


class ROIRequest(BaseModel):
    roi_type: str = "Rectangle"
    x: float
    y: float
    w: float
    h: float
    rotation_deg: float = 0
    hole_ratio: float = 50
    threshold: float = 0
    dpi: float | None = None
    trim_enabled: bool = False
    trim_percent: float = Field(default=2.0, ge=0, lt=50)
    corner_cut_enabled: bool = False
    corner_cut_mm: float = Field(default=0.0, ge=0)


class ROIPayload(BaseModel):
    """ROI geometry and options, in image coordinates."""

    roi_type: str = "Rectangle"
    x: float
    y: float
    w: float
    h: float
    rotation_deg: float = 0
    hole_ratio: float = 50
    threshold: float = 0
    trim_enabled: bool = False
    trim_percent: float = Field(default=2.0, ge=0, lt=50)
    corner_cut_enabled: bool = False
    corner_cut_mm: float = Field(default=0.0, ge=0)


class StatsPayload(BaseModel):
    """Computed ROI statistics, as returned by ``POST /{session_id}/roi``."""

    max: float | None = None
    min: float | None = None
    mean: float | None = None
    std: float | None = None
    cv: float | None = None
    dur: float | None = None
    flatness: float | None = None
    pixel_count: int | None = None
    center_x_mm: float | None = None
    center_y_mm: float | None = None
    width_mm: float | None = None
    height_mm: float | None = None
    area_mm2: float | None = None


class SaveRequest(BaseModel):
    profile_id: int | None = None
    channel: str = "Red"
    a: float = 0.0
    b: float = 0.0
    c: float = 0.0
    cmap_min: float | None = None
    cmap_max: float | None = None
    colormap: str = "jet"
    notes: str | None = None
    project_id: int | None = None
    # Present => overwrite that saved analysis instead of creating a new one.
    analysis_id: int | None = None
    roi: ROIPayload | None = None
    stats: StatsPayload | None = None


class AnalysisPatch(BaseModel):
    notes: str | None = None
    project_id: int | None = None
    # project_id=None is ambiguous in JSON (absent vs. explicit null), so unfiling
    # is requested with this flag.
    clear_project: bool = False


# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------

def _get_cache_entry(request: Request, session_id: str, user_id: int) -> dict:
    """Fetch the cache entry for *session_id*, scoped to its owner."""
    return get_cache_entry(request, session_id, user_id)


# ---------------------------------------------------------------------------
# Saved-analysis helpers
# ---------------------------------------------------------------------------

async def _get_user_analysis(
    analysis_id: int, user_id: int, db: AsyncSession
) -> AnalysisSession:
    """Fetch a saved analysis owned by *user_id*, or raise 404."""
    result = await db.execute(
        select(AnalysisSession)
        .options(
            selectinload(AnalysisSession.profile),
            selectinload(AnalysisSession.roi_measurements),
        )
        .where(
            AnalysisSession.id == analysis_id,
            AnalysisSession.user_id == user_id,
        )
    )
    record = result.scalars().first()
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Analysis not found",
        )
    return record


async def _build_profile_snapshot(
    profile_id: int | None,
    user_id: int,
    db: AsyncSession,
    channel: str,
    a: float,
    b: float,
    c: float,
) -> dict:
    """Capture the calibration behind an analysis so later edits cannot alter it.

    Falls back to recording just the applied coefficients when no profile is
    selected or the profile no longer exists.
    """
    applied = {
        "applied": {"channel": channel, "a": a, "b": b, "c": c},
        "snapshot_at": datetime.now(timezone.utc).isoformat(),
    }

    if profile_id is None:
        return {"profile_name": None, "channels": [], **applied}

    result = await db.execute(
        select(CalibrationProfile)
        .options(
            selectinload(CalibrationProfile.channel_params),
            selectinload(CalibrationProfile.calibration_points),
        )
        .where(
            CalibrationProfile.id == profile_id,
            CalibrationProfile.user_id == user_id,
        )
    )
    profile = result.scalars().first()
    if profile is None:
        return {"profile_name": None, "channels": [], **applied}

    return {
        "profile_id": profile.id,
        "profile_name": profile.name,
        "note": profile.note or "",
        "primary_channel": profile.primary_channel,
        "channels": [
            {
                "channel": cp.channel,
                "a": cp.a,
                "b": cp.b,
                "c": cp.c,
                "r_squared": cp.r_squared,
            }
            for cp in profile.channel_params
        ],
        "calibration_points": [
            {
                "dose": pt.dose,
                "red_pct": pt.red_pct,
                "green_pct": pt.green_pct,
                "blue_pct": pt.blue_pct,
                "source_filename": pt.source_filename,
            }
            for pt in profile.calibration_points
        ],
        **applied,
    }


def _same_calibration(record: AnalysisSession, body: "SaveRequest") -> bool:
    """True when an overwrite keeps the calibration the record already holds."""
    return (
        record.profile_snapshot is not None
        and record.profile_id == body.profile_id
        and record.channel == body.channel
        and record.a == body.a
        and record.b == body.b
        and record.c == body.c
    )


def _finite(value: float | None) -> float | None:
    """Drop non-finite statistics; flatness is inf when the ROI minimum is ~0."""
    if value is None:
        return None
    numeric = float(value)
    return numeric if math.isfinite(numeric) else None


def _build_roi_measurement(
    session_id: int, roi: ROIPayload, stats: StatsPayload | None
) -> ROIMeasurement:
    stats = stats or StatsPayload()
    return ROIMeasurement(
        session_id=session_id,
        roi_type=roi.roi_type,
        bbox_x=roi.x,
        bbox_y=roi.y,
        bbox_w=roi.w,
        bbox_h=roi.h,
        rotation_deg=roi.rotation_deg,
        hole_ratio=roi.hole_ratio,
        threshold=roi.threshold,
        trim_enabled=roi.trim_enabled,
        trim_percent=roi.trim_percent,
        corner_cut_enabled=roi.corner_cut_enabled,
        corner_cut_mm=roi.corner_cut_mm,
        pixel_count=stats.pixel_count,
        dose_max=_finite(stats.max),
        dose_min=_finite(stats.min),
        dose_mean=_finite(stats.mean),
        dose_std=_finite(stats.std),
        dose_cv=_finite(stats.cv),
        dur=_finite(stats.dur),
        flatness=_finite(stats.flatness),
        center_x_mm=_finite(stats.center_x_mm),
        center_y_mm=_finite(stats.center_y_mm),
        width_mm=_finite(stats.width_mm),
        height_mm=_finite(stats.height_mm),
        area_mm2=_finite(stats.area_mm2),
    )


def _snapshot_name(record: AnalysisSession) -> str | None:
    snapshot = record.profile_snapshot or {}
    return snapshot.get("profile_name")


def _profile_info(record: AnalysisSession) -> dict:
    """Describe the calibration profile, preferring the live one.

    Falls back to the snapshot name when the profile has been deleted, so history
    never shows a nameless calibration.
    """
    if record.profile is not None:
        return {
            "id": record.profile.id,
            "name": record.profile.name,
            "deleted": False,
        }
    name = _snapshot_name(record)
    if name:
        return {"id": None, "name": name, "deleted": True}
    return {"id": None, "name": None, "deleted": False}


def _roi_dict(m: ROIMeasurement) -> dict:
    return {
        "roi_type": m.roi_type,
        "x": m.bbox_x,
        "y": m.bbox_y,
        "w": m.bbox_w,
        "h": m.bbox_h,
        "rotation_deg": m.rotation_deg,
        "hole_ratio": m.hole_ratio,
        "threshold": m.threshold,
        "trim_enabled": m.trim_enabled,
        "trim_percent": m.trim_percent,
        "corner_cut_enabled": m.corner_cut_enabled,
        "corner_cut_mm": m.corner_cut_mm,
    }


def _stats_dict(m: ROIMeasurement) -> dict:
    return {
        "max": m.dose_max,
        "min": m.dose_min,
        "mean": m.dose_mean,
        "std": m.dose_std,
        "cv": m.dose_cv,
        "dur": m.dur,
        "flatness": m.flatness,
        "pixel_count": m.pixel_count,
        "center_x_mm": m.center_x_mm,
        "center_y_mm": m.center_y_mm,
        "width_mm": m.width_mm,
        "height_mm": m.height_mm,
        "area_mm2": m.area_mm2,
        "trim_enabled": m.trim_enabled,
        "trim_percent": m.trim_percent,
        "corner_cut_mm": m.corner_cut_mm,
        "roi_type": m.roi_type,
    }


def _summarize(record: AnalysisSession) -> dict:
    """History-row shape."""
    return {
        "id": record.id,
        "original_filename": record.original_filename,
        "project_id": record.project_id,
        "profile_id": record.profile_id,
        "profile": _profile_info(record),
        "channel": record.channel,
        "a": record.a,
        "b": record.b,
        "c": record.c,
        "dpi": record.dpi,
        "image_width": record.image_width,
        "image_height": record.image_height,
        "cmap_min": record.cmap_min,
        "cmap_max": record.cmap_max,
        "colormap": record.colormap,
        "notes": record.notes,
        "has_roi": len(record.roi_measurements) > 0,
        "has_file": Path(record.stored_filepath).is_file()
        if record.stored_filepath
        else False,
        "created_at": record.created_at.isoformat() if record.created_at else None,
        "updated_at": record.updated_at.isoformat() if record.updated_at else None,
    }


def _detail(record: AnalysisSession) -> dict:
    """Full restore payload: summary plus calibration provenance and ROI."""
    measurement = record.roi_measurements[0] if record.roi_measurements else None
    return {
        **_summarize(record),
        "image_channels": record.image_channels,
        "profile_snapshot": record.profile_snapshot,
        "roi": _roi_dict(measurement) if measurement else None,
        "stats": _stats_dict(measurement) if measurement else None,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/upload")
async def upload_image(
    file: UploadFile,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    session_id, save_path = await save_upload(
        file, current_user.id, ALLOWED_EXTENSIONS
    )

    # Load image into memory
    image_array, dpi, _w, _h, _ch = load_image(str(save_path))
    _dpi, has_dpi = read_dpi(str(save_path))

    h, w = image_array.shape[:2]
    channels = image_array.shape[2] if image_array.ndim == 3 else 1

    put_cache_entry(
        request,
        session_id,
        image_array=image_array,
        dpi=dpi,
        file_path=str(save_path),
        user_id=current_user.id,
        # Recorded so the image-analysis page can tell a real scan DPI from
        # the 72.0 fallback if this session is shared across tabs.
        has_dpi=has_dpi,
        # The stored file is named after the session uuid, so the user's own
        # filename only survives if it is kept here.
        original_filename=file.filename or "unknown",
        width=w,
        height=h,
        channels=channels,
    )

    return {
        "session_id": session_id,
        "width": w,
        "height": h,
        "dpi": dpi,
        "channels": channels,
        "filename": file.filename,
    }


@router.get("/{session_id}/preview")
async def preview_image(
    session_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    entry = _get_cache_entry(request, session_id, current_user.id)
    jpeg_bytes = generate_preview(entry["image_array"])
    return StreamingResponse(io.BytesIO(jpeg_bytes), media_type="image/jpeg")


@router.post("/{session_id}/calibrate")
async def calibrate(
    session_id: str,
    body: CalibrateRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    entry = _get_cache_entry(request, session_id, current_user.id)

    analyzer = FilmAnalyzer()
    analyzer.image_array = entry["image_array"]
    analyzer.dpi = entry["dpi"]

    dose_map = analyzer.calculate_dose_map(body.channel, body.a, body.b, body.c)

    # Clip dose map if bounds provided
    if body.cmap_min is not None or body.cmap_max is not None:
        low = body.cmap_min if body.cmap_min is not None else float(np.nanmin(dose_map))
        high = body.cmap_max if body.cmap_max is not None else float(np.nanmax(dose_map))
    else:
        low = float(np.nanmin(dose_map))
        high = float(np.nanmax(dose_map))

    entry["dose_map"] = dose_map
    entry["cmap_min"] = low
    entry["cmap_max"] = high

    return {
        "session_id": session_id,
        "dose_min": float(np.nanmin(dose_map)),
        "dose_max": float(np.nanmax(dose_map)),
        "dose_mean": float(np.nanmean(dose_map)),
    }


@router.get("/{session_id}/dose-preview")
async def dose_preview(
    session_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    entry = _get_cache_entry(request, session_id, current_user.id)
    if entry["dose_map"] is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Calibration has not been applied yet",
        )

    png_bytes = generate_dose_map_preview(
        entry["dose_map"],
        cmap_min=entry.get("cmap_min", 0),
        cmap_max=entry.get("cmap_max", 40),
    )
    return StreamingResponse(io.BytesIO(png_bytes), media_type="image/png")


@router.get("/{session_id}/dose-data")
async def dose_data(
    session_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    """Return the dose map as raw Float32 binary data with metadata in headers."""
    entry = _get_cache_entry(request, session_id, current_user.id)
    if entry["dose_map"] is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Calibration has not been applied yet",
        )

    dose_map: np.ndarray = entry["dose_map"]

    # Replace NaN with 0
    clean = np.where(np.isnan(dose_map), 0.0, dose_map).astype(np.float32)

    # Ensure C-contiguous layout
    if not clean.flags["C_CONTIGUOUS"]:
        clean = np.ascontiguousarray(clean)

    height, width = clean.shape[:2]
    dose_min = float(clean.min())
    dose_max = float(clean.max())
    cmap_min = entry.get("cmap_min", 0)
    cmap_max = entry.get("cmap_max", 40)

    custom_headers = {
        "X-Width": str(width),
        "X-Height": str(height),
        "X-Dose-Min": str(dose_min),
        "X-Dose-Max": str(dose_max),
        "X-Cmap-Min": str(cmap_min),
        "X-Cmap-Max": str(cmap_max),
        "Access-Control-Expose-Headers": "X-Width, X-Height, X-Dose-Min, X-Dose-Max, X-Cmap-Min, X-Cmap-Max",
    }

    return StreamingResponse(
        io.BytesIO(clean.tobytes()),
        media_type="application/octet-stream",
        headers=custom_headers,
    )


@router.post("/{session_id}/roi")
async def compute_roi(
    session_id: str,
    body: ROIRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    entry = _get_cache_entry(request, session_id, current_user.id)
    if entry["dose_map"] is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Calibration has not been applied yet",
        )

    dose_map: np.ndarray = entry["dose_map"]
    dpi = body.dpi if body.dpi is not None else entry["dpi"]

    corner_cut_px = 0.0
    if (
        body.roi_type == "Rectangle"
        and body.corner_cut_enabled
        and body.corner_cut_mm > 0
    ):
        corner_cut_px = body.corner_cut_mm * dpi / 25.4

    mask = build_roi_mask(
        shape=dose_map.shape,
        roi_type=body.roi_type,
        x=body.x,
        y=body.y,
        w=body.w,
        h=body.h,
        rotation_deg=body.rotation_deg,
        hole_ratio=body.hole_ratio,
        threshold=body.threshold,
        dose_map=dose_map,
        corner_cut_px=corner_cut_px,
    )

    analyzer = FilmAnalyzer()
    analyzer.dose_map = dose_map
    stats = analyzer.get_roi_stats(
        mask,
        trim_enabled=body.trim_enabled,
        trim_percent=body.trim_percent,
    )

    if stats is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No valid pixels in the selected ROI",
        )

    # Compute physical dimensions
    mm_per_px = 25.4 / dpi if dpi > 0 else 0
    pixel_count = int(np.sum(mask))
    area_mm2 = pixel_count * (mm_per_px ** 2)

    center_x_mm = (body.x + body.w / 2) * mm_per_px
    center_y_mm = (body.y + body.h / 2) * mm_per_px
    width_mm = body.w * mm_per_px
    height_mm = body.h * mm_per_px

    stats["pixel_count"] = pixel_count
    stats["area_mm2"] = round(area_mm2, 2)
    stats["center_x_mm"] = round(center_x_mm, 2)
    stats["center_y_mm"] = round(center_y_mm, 2)
    stats["width_mm"] = round(width_mm, 2)
    stats["height_mm"] = round(height_mm, 2)
    stats["dpi"] = dpi
    stats["roi_type"] = body.roi_type
    stats["trim_enabled"] = body.trim_enabled
    stats["trim_percent"] = body.trim_percent
    stats["corner_cut_mm"] = (
        body.corner_cut_mm if corner_cut_px > 0 else 0.0
    )

    return stats


@router.post("/{session_id}/save")
async def save_analysis(
    session_id: str,
    body: SaveRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Persist an analysis, or overwrite an existing one when ``analysis_id`` is set.

    The film file is copied into storage the record owns, and the calibration is
    snapshotted, so the saved analysis stays reproducible after the cache expires
    and after the source profile is edited or deleted.
    """
    entry = _get_cache_entry(request, session_id, current_user.id)

    if body.project_id is not None:
        await get_user_project(body.project_id, current_user.id, db)

    cmap_min = (
        body.cmap_min if body.cmap_min is not None else entry.get("cmap_min", 0.0)
    )
    cmap_max = (
        body.cmap_max if body.cmap_max is not None else entry.get("cmap_max", 40.0)
    )

    if body.analysis_id is not None:
        record = await _get_user_analysis(body.analysis_id, current_user.id, db)

        # Re-snapshot only when the calibration itself changed. Continuing a
        # study with the same coefficients must not attach a newer state of the
        # profile, which is not what produced these results.
        if not _same_calibration(record, body):
            record.profile_snapshot = await _build_profile_snapshot(
                body.profile_id, current_user.id, db,
                body.channel, body.a, body.b, body.c,
            )

        record.profile_id = body.profile_id
        record.project_id = body.project_id
        record.dpi = entry["dpi"]
        record.channel = body.channel
        record.a, record.b, record.c = body.a, body.b, body.c
        record.cmap_min, record.cmap_max = cmap_min, cmap_max
        record.colormap = body.colormap
        record.notes = body.notes or ""
        # The image is immutable, so the owned file is kept as-is. Setting
        # updated_at explicitly: onupdate does not fire when only ROI rows change.
        record.updated_at = datetime.now(timezone.utc)

        for existing in list(record.roi_measurements):
            await db.delete(existing)
        await db.flush()
    else:
        snapshot = await _build_profile_snapshot(
            body.profile_id, current_user.id, db,
            body.channel, body.a, body.b, body.c,
        )
        try:
            owned_path = own_file(entry.get("file_path", ""), current_user.id)
        except FileNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail="The uploaded film file is no longer available on the server",
            )

        record = AnalysisSession(
            user_id=current_user.id,
            profile_id=body.profile_id,
            project_id=body.project_id,
            original_filename=entry.get("original_filename")
            or Path(entry.get("file_path", "unknown")).name,
            stored_filepath=str(owned_path),
            dpi=entry["dpi"],
            image_width=entry.get("width"),
            image_height=entry.get("height"),
            image_channels=entry.get("channels"),
            channel=body.channel,
            a=body.a,
            b=body.b,
            c=body.c,
            cmap_min=cmap_min,
            cmap_max=cmap_max,
            colormap=body.colormap,
            profile_snapshot=snapshot,
            notes=body.notes or "",
        )
        db.add(record)
        await db.flush()

    if body.roi is not None:
        db.add(_build_roi_measurement(record.id, body.roi, body.stats))
        await db.flush()

    await db.refresh(record)

    return {
        "id": record.id,
        "original_filename": record.original_filename,
        "project_id": record.project_id,
        "created_at": record.created_at.isoformat() if record.created_at else None,
        "updated_at": record.updated_at.isoformat() if record.updated_at else None,
    }


@router.get("/history")
async def analysis_history(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AnalysisSession)
        .options(
            selectinload(AnalysisSession.profile),
            selectinload(AnalysisSession.roi_measurements),
        )
        .where(AnalysisSession.user_id == current_user.id)
        .order_by(AnalysisSession.id.desc())
    )
    return [_summarize(s) for s in result.scalars().all()]


# ---------------------------------------------------------------------------
# Saved analyses
#
# These operate on the database id, not the in-memory cache uuid. They live under
# the literal "saved" segment so they can never shadow GET /history, which is
# declared after the parametric /{session_id}/... routes above.
# ---------------------------------------------------------------------------

@router.get("/saved/{analysis_id}")
async def get_saved_analysis(
    analysis_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Everything needed to restore this analysis on the film analysis page."""
    record = await _get_user_analysis(analysis_id, current_user.id, db)
    return _detail(record)


@router.post("/saved/{analysis_id}/open")
async def open_saved_analysis(
    analysis_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Reload a saved analysis's film into a fresh working session.

    Returns a new cache ``session_id`` alongside the saved state. The dose map is
    not computed here -- the client re-runs ``/calibrate`` with the snapshot
    coefficients, so there is a single code path producing dose maps.
    """
    record = await _get_user_analysis(analysis_id, current_user.id, db)

    path = Path(record.stored_filepath)
    if not path.is_file():
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="The original film file is no longer available on the server",
        )

    try:
        image_array, file_dpi, _w, _h, _ch = load_image(str(path))
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The stored film file could not be read",
        )
    _dpi, has_dpi = read_dpi(str(path))

    h, w = image_array.shape[:2]
    channels = image_array.shape[2] if image_array.ndim == 3 else 1
    # The saved DPI wins: it is what the stored measurements were computed with.
    dpi = record.dpi or file_dpi

    session_id = str(uuid.uuid4())
    put_cache_entry(
        request,
        session_id,
        image_array=image_array,
        dpi=dpi,
        file_path=str(path),
        user_id=current_user.id,
        has_dpi=has_dpi,
        original_filename=record.original_filename,
        width=w,
        height=h,
        channels=channels,
        cmap_min=record.cmap_min,
        cmap_max=record.cmap_max,
    )

    detail = _detail(record)
    detail.update(
        {
            "session_id": session_id,
            "width": w,
            "height": h,
            "channels": channels,
            "dpi": dpi,
        }
    )
    return detail


@router.patch("/saved/{analysis_id}")
async def patch_saved_analysis(
    analysis_id: int,
    body: AnalysisPatch,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update notes and/or project membership without reopening the analysis."""
    record = await _get_user_analysis(analysis_id, current_user.id, db)

    if body.notes is not None:
        record.notes = body.notes
    if body.clear_project:
        record.project_id = None
    elif body.project_id is not None:
        await get_user_project(body.project_id, current_user.id, db)
        record.project_id = body.project_id

    record.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(record)
    return _summarize(record)


@router.delete("/saved/{analysis_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_saved_analysis(
    analysis_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    record = await _get_user_analysis(analysis_id, current_user.id, db)

    # A "save as new" copies the file, but legacy rows can still share a path.
    others = (
        await db.execute(
            select(func.count(AnalysisSession.id)).where(
                AnalysisSession.stored_filepath == record.stored_filepath,
                AnalysisSession.id != record.id,
            )
        )
    ).scalar_one()

    stored_path = record.stored_filepath
    await db.delete(record)
    await db.flush()

    delete_owned_file(stored_path, current_user.id, still_referenced=others > 0)


@router.get("/saved/{analysis_id}/file")
async def download_saved_film(
    analysis_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Download the original film scan under the name the user uploaded it with."""
    record = await _get_user_analysis(analysis_id, current_user.id, db)

    path = Path(record.stored_filepath)
    if not path.is_file():
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="The original film file is no longer available on the server",
        )

    return FileResponse(
        str(path),
        filename=record.original_filename or path.name,
        media_type="application/octet-stream",
    )


@router.get("/saved/{analysis_id}/export")
async def export_csv(
    analysis_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Export a saved analysis's ROI measurements as CSV."""
    record = await _get_user_analysis(analysis_id, current_user.id, db)

    meta = [
        f"# file,{record.original_filename}",
        f"# channel,{record.channel}",
        f"# a,{record.a}",
        f"# b,{record.b}",
        f"# c,{record.c}",
        f"# dpi,{record.dpi}",
        f"# profile,{_snapshot_name(record) or ''}",
        f"# saved,{record.created_at.isoformat() if record.created_at else ''}",
    ]

    headers = [
        "roi_type", "bbox_x", "bbox_y", "bbox_w", "bbox_h",
        "rotation_deg", "hole_ratio", "threshold",
        "trim_enabled", "trim_percent", "corner_cut_enabled", "corner_cut_mm",
        "pixel_count",
        "dose_max", "dose_min", "dose_mean", "dose_std",
        "dose_cv", "dur", "flatness",
        "center_x_mm", "center_y_mm", "width_mm", "height_mm", "area_mm2",
    ]
    lines = [*meta, ",".join(headers)]
    for m in record.roi_measurements:
        lines.append(
            ",".join(
                "" if getattr(m, col, None) is None else str(getattr(m, col))
                for col in headers
            )
        )
    csv_content = "\n".join(lines) + "\n"

    base = Path(record.original_filename or "analysis").stem
    return StreamingResponse(
        io.BytesIO(csv_content.encode("utf-8")),
        media_type="text/csv",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{base}_analysis_{analysis_id}.csv"'
            )
        },
    )
