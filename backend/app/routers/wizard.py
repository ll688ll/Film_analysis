"""Calibration wizard endpoints: upload, extract points, fit curves, save."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models import CalibrationPoint, CalibrationProfile, ChannelParams, User
from app.services.calibration import extract_color_percentages, fit_calibration_curves
from app.services.image_utils import load_image

router = APIRouter(prefix="/wizard", tags=["wizard"])

ALLOWED_EXTENSIONS = {".tif", ".tiff", ".png", ".jpg", ".jpeg"}


# ---------------------------------------------------------------------------
# Request / response bodies
# ---------------------------------------------------------------------------

class ExtractPointRequest(BaseModel):
    wizard_session_id: str
    x: float
    y: float
    w: float
    h: float
    dose: float


class CalibrationPointIn(BaseModel):
    dose: float
    red_pct: float
    green_pct: float
    blue_pct: float


class FitCurvesRequest(BaseModel):
    points: list[CalibrationPointIn]


class ChannelFitResult(BaseModel):
    a: float
    b: float
    c: float
    r_squared: float


class FitCurvesResponse(BaseModel):
    Red: ChannelFitResult
    Green: ChannelFitResult
    Blue: ChannelFitResult


class FittedParamsIn(BaseModel):
    Red: ChannelFitResult
    Green: ChannelFitResult
    Blue: ChannelFitResult


class SaveProfileRequest(BaseModel):
    name: str
    note: str | None = None
    primary_channel: str = "Red"
    fitted_params: FittedParamsIn
    points: list[CalibrationPointIn]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/upload-image")
async def upload_wizard_image(
    file: UploadFile,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type '{suffix}'. Allowed: {', '.join(ALLOWED_EXTENSIONS)}",
        )

    contents = await file.read()
    if len(contents) > settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds {settings.MAX_UPLOAD_SIZE_MB} MB limit",
        )

    user_dir = Path(settings.UPLOAD_DIR) / str(current_user.id) / "wizard"
    user_dir.mkdir(parents=True, exist_ok=True)

    wizard_session_id = str(uuid.uuid4())
    save_path = user_dir / f"{wizard_session_id}{suffix}"
    save_path.write_bytes(contents)

    image_array, dpi, _w, _h, _ch = load_image(str(save_path))

    cache: dict = request.app.state.image_cache
    cache[wizard_session_id] = {
        "image_array": image_array,
        "dose_map": None,
        "dpi": dpi,
        "last_accessed": datetime.now(timezone.utc),
        "file_path": str(save_path),
        "user_id": current_user.id,
    }

    return {
        "wizard_session_id": wizard_session_id,
        "preview_url": f"/api/analysis/{wizard_session_id}/preview",
    }


@router.post("/extract-point")
async def extract_point(
    body: ExtractPointRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    cache: dict = request.app.state.image_cache
    entry = cache.get(body.wizard_session_id)
    if entry is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Wizard session not found or expired",
        )
    entry["last_accessed"] = datetime.now(timezone.utc)

    image_array = entry["image_array"]

    colors = extract_color_percentages(
        image_array,
        x=int(body.x),
        y=int(body.y),
        w=int(body.w),
        h=int(body.h),
    )

    return {
        "dose": body.dose,
        "red_pct": colors["red_pct"],
        "green_pct": colors["green_pct"],
        "blue_pct": colors["blue_pct"],
    }


@router.post("/fit-curves", response_model=FitCurvesResponse)
async def fit_curves(
    body: FitCurvesRequest,
    current_user: User = Depends(get_current_user),
):
    if len(body.points) < 3:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least 3 calibration points are required for curve fitting",
        )

    points_dicts = [p.model_dump() for p in body.points]
    result = fit_calibration_curves(points_dicts)
    return result


@router.post("/save-profile", status_code=status.HTTP_201_CREATED)
async def save_profile(
    body: SaveProfileRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Check for duplicate profile name
    from sqlalchemy import select
    existing = await db.execute(
        select(CalibrationProfile).where(
            CalibrationProfile.user_id == current_user.id,
            CalibrationProfile.name == body.name,
        )
    )
    if existing.scalars().first() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A profile named '{body.name}' already exists.",
        )

    profile = CalibrationProfile(
        name=body.name,
        note=body.note or "",
        primary_channel=body.primary_channel,
        user_id=current_user.id,
    )
    db.add(profile)
    await db.flush()

    # Save channel params for each fitted channel
    for channel_name in ("Red", "Green", "Blue"):
        params = getattr(body.fitted_params, channel_name)
        db.add(ChannelParams(
            profile_id=profile.id,
            channel=channel_name,
            a=params.a,
            b=params.b,
            c=params.c,
        ))

    # Save calibration points
    for pt in body.points:
        db.add(CalibrationPoint(
            profile_id=profile.id,
            dose=pt.dose,
            red_pct=pt.red_pct,
            green_pct=pt.green_pct,
            blue_pct=pt.blue_pct,
        ))

    await db.flush()
    await db.refresh(profile)

    return {
        "id": profile.id,
        "name": profile.name,
        "primary_channel": profile.primary_channel,
    }
