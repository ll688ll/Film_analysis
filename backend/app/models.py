from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    profiles: Mapped[list["CalibrationProfile"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    analysis_sessions: Mapped[list["AnalysisSession"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class CalibrationProfile(Base):
    __tablename__ = "calibration_profiles"
    __table_args__ = (UniqueConstraint("user_id", "name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    note: Mapped[str] = mapped_column(Text, default="")
    primary_channel: Mapped[str] = mapped_column(String(10), default="Red")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    user: Mapped["User"] = relationship(back_populates="profiles")
    channel_params: Mapped[list["ChannelParams"]] = relationship(
        back_populates="profile", cascade="all, delete-orphan"
    )
    calibration_points: Mapped[list["CalibrationPoint"]] = relationship(
        back_populates="profile", cascade="all, delete-orphan"
    )


class ChannelParams(Base):
    __tablename__ = "channel_params"
    __table_args__ = (UniqueConstraint("profile_id", "channel"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    profile_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("calibration_profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    channel: Mapped[str] = mapped_column(String(10), nullable=False)
    a: Mapped[float] = mapped_column(Float, nullable=False)
    b: Mapped[float] = mapped_column(Float, nullable=False)
    c: Mapped[float] = mapped_column(Float, nullable=False)
    r_squared: Mapped[float | None] = mapped_column(Float, nullable=True)

    profile: Mapped["CalibrationProfile"] = relationship(
        back_populates="channel_params"
    )


class CalibrationPoint(Base):
    __tablename__ = "calibration_points"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    profile_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("calibration_profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    dose: Mapped[float] = mapped_column(Float, nullable=False)
    red_pct: Mapped[float] = mapped_column(Float, nullable=False)
    green_pct: Mapped[float] = mapped_column(Float, nullable=False)
    blue_pct: Mapped[float] = mapped_column(Float, nullable=False)
    source_filename: Mapped[str] = mapped_column(String(255), default="")

    profile: Mapped["CalibrationProfile"] = relationship(
        back_populates="calibration_points"
    )


class AnalysisSession(Base):
    __tablename__ = "analysis_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    profile_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("calibration_profiles.id", ondelete="SET NULL"),
        nullable=True,
    )
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    stored_filepath: Mapped[str] = mapped_column(String(500), nullable=False)
    dpi: Mapped[float] = mapped_column(Float, default=72.0)
    channel: Mapped[str] = mapped_column(String(10), nullable=False)
    a: Mapped[float] = mapped_column(Float, nullable=False)
    b: Mapped[float] = mapped_column(Float, nullable=False)
    c: Mapped[float] = mapped_column(Float, nullable=False)
    cmap_min: Mapped[float] = mapped_column(Float, default=0.0)
    cmap_max: Mapped[float] = mapped_column(Float, default=40.0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow
    )
    notes: Mapped[str] = mapped_column(Text, default="")

    user: Mapped["User"] = relationship(back_populates="analysis_sessions")
    roi_measurements: Mapped[list["ROIMeasurement"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )


class ROIMeasurement(Base):
    __tablename__ = "roi_measurements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("analysis_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    roi_type: Mapped[str] = mapped_column(String(20), nullable=False)
    bbox_x: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_y: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_w: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_h: Mapped[float] = mapped_column(Float, nullable=False)
    rotation_deg: Mapped[float] = mapped_column(Float, default=0.0)
    hole_ratio: Mapped[float] = mapped_column(Float, default=50.0)
    threshold: Mapped[float] = mapped_column(Float, default=0.0)
    dose_max: Mapped[float | None] = mapped_column(Float, nullable=True)
    dose_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    dose_mean: Mapped[float | None] = mapped_column(Float, nullable=True)
    dose_std: Mapped[float | None] = mapped_column(Float, nullable=True)
    dose_cv: Mapped[float | None] = mapped_column(Float, nullable=True)
    dur: Mapped[float | None] = mapped_column(Float, nullable=True)
    flatness: Mapped[float | None] = mapped_column(Float, nullable=True)
    center_x_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    center_y_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    width_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    height_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    area_mm2: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow
    )

    session: Mapped["AnalysisSession"] = relationship(
        back_populates="roi_measurements"
    )
