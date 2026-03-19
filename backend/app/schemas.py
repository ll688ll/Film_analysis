from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field


# ── Auth / User ──────────────────────────────────────────────────────────────


class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr
    password: str = Field(..., min_length=6)


class UserLogin(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    id: int
    username: str
    email: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ── Channel Params ───────────────────────────────────────────────────────────


class ChannelParamsSchema(BaseModel):
    channel: str = Field(..., max_length=10)
    a: float
    b: float
    c: float
    r_squared: Optional[float] = None

    model_config = {"from_attributes": True}


# ── Calibration Point ────────────────────────────────────────────────────────


class CalibrationPointSchema(BaseModel):
    dose: float
    red_pct: float
    green_pct: float
    blue_pct: float
    source_filename: str = ""

    model_config = {"from_attributes": True}


# ── Calibration Profile ──────────────────────────────────────────────────────


class ProfileCreate(BaseModel):
    name: str = Field(..., max_length=100)
    note: str = ""
    primary_channel: str = "Red"
    channel_params: list[ChannelParamsSchema] = []
    calibration_points: list[CalibrationPointSchema] = []


class ProfileUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=100)
    note: Optional[str] = None
    primary_channel: Optional[str] = None
    channel_params: Optional[list[ChannelParamsSchema]] = None
    calibration_points: Optional[list[CalibrationPointSchema]] = None


class ProfileResponse(BaseModel):
    id: int
    user_id: int
    name: str
    note: str
    primary_channel: str
    created_at: datetime
    updated_at: datetime
    channel_params: list[ChannelParamsSchema] = []
    calibration_points: list[CalibrationPointSchema] = []

    model_config = {"from_attributes": True}


# ── Profile Import (legacy calibration_config.json) ─────────────────────────


class ProfileImport(BaseModel):
    """Import format matching the legacy calibration_config.json structure."""

    name: str = Field(..., max_length=100)
    note: str = ""
    primary_channel: str = "Red"
    channel_params: dict[str, ChannelParamsSchema] = {}
    calibration_points: list[CalibrationPointSchema] = []


# ── Analysis ─────────────────────────────────────────────────────────────────


class AnalysisUploadResponse(BaseModel):
    session_id: int
    original_filename: str
    dpi: float
    width_px: int
    height_px: int


class CalibrateRequest(BaseModel):
    profile_id: Optional[int] = None
    channel: str = "Red"
    a: float
    b: float
    c: float
    cmap_min: float = 0.0
    cmap_max: float = 40.0


class ROIRequest(BaseModel):
    roi_type: str = Field(..., pattern=r"^(Rectangle|Circle|Ring)$")
    bbox_x: float
    bbox_y: float
    bbox_w: float
    bbox_h: float
    rotation_deg: float = 0.0
    hole_ratio: float = 50.0
    threshold: float = 0.0


class ROIStatsResponse(BaseModel):
    roi_id: int
    roi_type: str
    dose_max: Optional[float] = None
    dose_min: Optional[float] = None
    dose_mean: Optional[float] = None
    dose_std: Optional[float] = None
    dose_cv: Optional[float] = None
    dur: Optional[float] = None
    flatness: Optional[float] = None
    center_x_mm: Optional[float] = None
    center_y_mm: Optional[float] = None
    width_mm: Optional[float] = None
    height_mm: Optional[float] = None
    area_mm2: Optional[float] = None

    model_config = {"from_attributes": True}


# ── Wizard ───────────────────────────────────────────────────────────────────


class WizardExtractPointRequest(BaseModel):
    dose: float
    bbox_x: float
    bbox_y: float
    bbox_w: float
    bbox_h: float


class WizardExtractPointResponse(BaseModel):
    dose: float
    red_pct: float
    green_pct: float
    blue_pct: float


class WizardFitRequest(BaseModel):
    points: list[CalibrationPointSchema]
    primary_channel: str = "Red"


class WizardFitResponse(BaseModel):
    channel_params: list[ChannelParamsSchema]
    primary_channel: str


# ── Session / ROI Responses ──────────────────────────────────────────────────


class ROIMeasurementResponse(BaseModel):
    id: int
    session_id: int
    roi_type: str
    bbox_x: float
    bbox_y: float
    bbox_w: float
    bbox_h: float
    rotation_deg: float
    hole_ratio: float
    threshold: float
    dose_max: Optional[float] = None
    dose_min: Optional[float] = None
    dose_mean: Optional[float] = None
    dose_std: Optional[float] = None
    dose_cv: Optional[float] = None
    dur: Optional[float] = None
    flatness: Optional[float] = None
    center_x_mm: Optional[float] = None
    center_y_mm: Optional[float] = None
    width_mm: Optional[float] = None
    height_mm: Optional[float] = None
    area_mm2: Optional[float] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class AnalysisSessionResponse(BaseModel):
    id: int
    user_id: int
    profile_id: Optional[int] = None
    original_filename: str
    stored_filepath: str
    dpi: float
    channel: str
    a: float
    b: float
    c: float
    cmap_min: float
    cmap_max: float
    created_at: datetime
    notes: str
    roi_measurements: list[ROIMeasurementResponse] = []

    model_config = {"from_attributes": True}
