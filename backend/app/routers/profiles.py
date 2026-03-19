"""Calibration profile CRUD endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user
from app.models import CalibrationProfile, ChannelParams, User

router = APIRouter(prefix="/profiles", tags=["profiles"])


# ---------------------------------------------------------------------------
# Request / response schemas local to this router
# ---------------------------------------------------------------------------

class ChannelParamsIn(BaseModel):
    channel: str  # "Red", "Green", "Blue"
    a: float
    b: float
    c: float


class ProfileCreate(BaseModel):
    name: str
    note: str | None = None
    primary_channel: str | None = None
    channels: list[ChannelParamsIn]


class ProfileUpdate(BaseModel):
    name: str | None = None
    note: str | None = None
    primary_channel: str | None = None
    channels: list[ChannelParamsIn] | None = None


class ChannelParamsOut(BaseModel):
    channel: str
    a: float
    b: float
    c: float

    class Config:
        from_attributes = True


class ProfileOut(BaseModel):
    id: int
    name: str
    note: str | None = None
    primary_channel: str | None = None
    channel_params: list[ChannelParamsOut] = []

    class Config:
        from_attributes = True


class LegacyImportPayload(BaseModel):
    profiles: dict[str, Any]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _eager_load():
    return selectinload(CalibrationProfile.channel_params)


async def _get_user_profile(
    profile_id: int, user_id: int, db: AsyncSession
) -> CalibrationProfile:
    result = await db.execute(
        select(CalibrationProfile)
        .options(_eager_load())
        .where(
            CalibrationProfile.id == profile_id,
            CalibrationProfile.user_id == user_id,
        )
    )
    profile = result.scalars().first()
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")
    return profile


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("", response_model=list[ProfileOut])
async def list_profiles(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CalibrationProfile)
        .options(_eager_load())
        .where(CalibrationProfile.user_id == current_user.id)
        .order_by(CalibrationProfile.id)
    )
    return result.scalars().all()


@router.post("", response_model=ProfileOut, status_code=status.HTTP_201_CREATED)
async def create_profile(
    body: ProfileCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    profile = CalibrationProfile(
        name=body.name,
        note=body.note or "",
        primary_channel=body.primary_channel,
        user_id=current_user.id,
    )
    db.add(profile)
    await db.flush()

    for ch in body.channels:
        db.add(ChannelParams(
            profile_id=profile.id,
            channel=ch.channel,
            a=ch.a,
            b=ch.b,
            c=ch.c,
        ))
    await db.flush()
    await db.refresh(profile, attribute_names=["channel_params"])
    return profile


@router.get("/{profile_id}", response_model=ProfileOut)
async def get_profile(
    profile_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await _get_user_profile(profile_id, current_user.id, db)


@router.put("/{profile_id}", response_model=ProfileOut)
async def update_profile(
    profile_id: int,
    body: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    profile = await _get_user_profile(profile_id, current_user.id, db)

    if body.name is not None:
        profile.name = body.name
    if body.note is not None:
        profile.note = body.note
    if body.primary_channel is not None:
        profile.primary_channel = body.primary_channel

    if body.channels is not None:
        # Replace existing channel params
        for existing in list(profile.channel_params):
            await db.delete(existing)
        await db.flush()

        for ch in body.channels:
            db.add(ChannelParams(
                profile_id=profile.id,
                channel=ch.channel,
                a=ch.a,
                b=ch.b,
                c=ch.c,
            ))
        await db.flush()
        await db.refresh(profile, attribute_names=["channel_params"])

    return profile


@router.delete("/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_profile(
    profile_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    profile = await _get_user_profile(profile_id, current_user.id, db)
    await db.delete(profile)


@router.post("/import", response_model=list[ProfileOut], status_code=status.HTTP_201_CREATED)
async def import_legacy_profiles(
    body: LegacyImportPayload,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Import profiles from a legacy calibration_config.json structure."""
    created: list[CalibrationProfile] = []

    for _key, pdata in body.profiles.items():
        profile = CalibrationProfile(
            name=pdata.get("name", _key),
            note=pdata.get("note"),
            primary_channel=pdata.get("color_channel"),
            user_id=current_user.id,
        )
        db.add(profile)
        await db.flush()

        channels = pdata.get("channels", {})
        for ch_name, coeffs in channels.items():
            db.add(ChannelParams(
                profile_id=profile.id,
                channel=ch_name,
                a=coeffs["a"],
                b=coeffs["b"],
                c=coeffs["c"],
            ))

        await db.flush()
        await db.refresh(profile, attribute_names=["channel_params"])
        created.append(profile)

    return created
