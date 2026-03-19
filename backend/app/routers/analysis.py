"""Film analysis endpoints: upload, preview, calibrate, ROI, save, export."""

from __future__ import annotations

import io
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models import AnalysisSession, CalibrationProfile, ChannelParams, User
from app.services.film_analyzer import FilmAnalyzer, build_roi_mask
from app.services.image_utils import (
    generate_dose_map_preview,
    generate_preview,
    load_image,
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


class SaveRequest(BaseModel):
    profile_id: int | None = None
    channel: str = "Red"
    a: float = 0.0
    b: float = 0.0
    c: float = 0.0
    notes: str | None = None


# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------

def _get_cache_entry(request: Request, session_id: str) -> dict:
    cache: dict = request.app.state.image_cache
    entry = cache.get(session_id)
    if entry is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found or expired",
        )
    entry["last_accessed"] = datetime.now(timezone.utc)
    return entry


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/upload")
async def upload_image(
    file: UploadFile,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    # Validate extension
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type '{suffix}'. Allowed: {', '.join(ALLOWED_EXTENSIONS)}",
        )

    # Read file contents
    contents = await file.read()
    if len(contents) > settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds {settings.MAX_UPLOAD_SIZE_MB} MB limit",
        )

    # Persist to disk
    user_dir = Path(settings.UPLOAD_DIR) / str(current_user.id)
    user_dir.mkdir(parents=True, exist_ok=True)

    session_id = str(uuid.uuid4())
    save_path = user_dir / f"{session_id}{suffix}"
    save_path.write_bytes(contents)

    # Load image into memory
    image_array, dpi, _w, _h, _ch = load_image(str(save_path))

    # Store in cache
    cache: dict = request.app.state.image_cache
    cache[session_id] = {
        "image_array": image_array,
        "dose_map": None,
        "dpi": dpi,
        "last_accessed": datetime.now(timezone.utc),
        "file_path": str(save_path),
        "user_id": current_user.id,
    }

    h, w = image_array.shape[:2]
    channels = image_array.shape[2] if image_array.ndim == 3 else 1

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
    entry = _get_cache_entry(request, session_id)
    jpeg_bytes = generate_preview(entry["image_array"])
    return StreamingResponse(io.BytesIO(jpeg_bytes), media_type="image/jpeg")


@router.post("/{session_id}/calibrate")
async def calibrate(
    session_id: str,
    body: CalibrateRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    entry = _get_cache_entry(request, session_id)

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
    entry = _get_cache_entry(request, session_id)
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
    entry = _get_cache_entry(request, session_id)
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
    entry = _get_cache_entry(request, session_id)
    if entry["dose_map"] is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Calibration has not been applied yet",
        )

    dose_map: np.ndarray = entry["dose_map"]
    dpi = body.dpi if body.dpi is not None else entry["dpi"]

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
    )

    analyzer = FilmAnalyzer()
    analyzer.dose_map = dose_map
    stats = analyzer.get_roi_stats(mask)

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

    return stats


@router.post("/{session_id}/save")
async def save_analysis(
    session_id: str,
    body: SaveRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    entry = _get_cache_entry(request, session_id)

    session_record = AnalysisSession(
        user_id=current_user.id,
        profile_id=body.profile_id,
        original_filename=Path(entry.get("file_path", "unknown")).name,
        stored_filepath=entry.get("file_path", ""),
        dpi=entry["dpi"],
        channel=body.channel,
        a=body.a,
        b=body.b,
        c=body.c,
        cmap_min=entry.get("cmap_min", 0.0),
        cmap_max=entry.get("cmap_max", 40.0),
        notes=body.notes or "",
    )
    db.add(session_record)
    await db.flush()
    await db.refresh(session_record)

    return {
        "id": session_record.id,
        "original_filename": session_record.original_filename,
        "created_at": session_record.created_at.isoformat() if session_record.created_at else None,
    }


@router.get("/history")
async def analysis_history(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AnalysisSession)
        .where(AnalysisSession.user_id == current_user.id)
        .order_by(AnalysisSession.id.desc())
    )
    sessions = result.scalars().all()
    return [
        {
            "id": s.id,
            "original_filename": s.original_filename,
            "profile_id": s.profile_id,
            "channel": s.channel,
            "a": s.a,
            "b": s.b,
            "c": s.c,
            "dpi": s.dpi,
            "cmap_min": s.cmap_min,
            "cmap_max": s.cmap_max,
            "notes": s.notes,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        }
        for s in sessions
    ]


@router.get("/{session_id}/export")
async def export_csv(
    session_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Export ROI measurements for a session as CSV."""
    from app.models import ROIMeasurement

    # Check the session belongs to the user
    result = await db.execute(
        select(AnalysisSession).where(
            AnalysisSession.id == int(session_id),
            AnalysisSession.user_id == current_user.id,
        )
    )
    session_record = result.scalars().first()
    if session_record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Analysis session not found",
        )

    # Fetch ROI measurements
    meas_result = await db.execute(
        select(ROIMeasurement).where(
            ROIMeasurement.session_id == session_record.id
        )
    )
    measurements = meas_result.scalars().all()

    headers = [
        "roi_type", "bbox_x", "bbox_y", "bbox_w", "bbox_h",
        "rotation_deg", "hole_ratio", "threshold",
        "dose_max", "dose_min", "dose_mean", "dose_std",
        "dose_cv", "dur", "flatness",
        "center_x_mm", "center_y_mm", "width_mm", "height_mm", "area_mm2",
    ]
    lines = [",".join(headers)]
    for m in measurements:
        lines.append(",".join(str(getattr(m, h, "")) for h in headers))
    csv_content = "\n".join(lines) + "\n"

    return StreamingResponse(
        io.BytesIO(csv_content.encode("utf-8")),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="analysis_{session_id}.csv"'
        },
    )
