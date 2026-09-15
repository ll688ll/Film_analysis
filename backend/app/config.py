from pydantic_settings import BaseSettings

# Single source of truth for the application version. Keep in sync with
# frontend/package.json and the CHANGELOG.
APP_VERSION = "1.6.0"


class Settings(BaseSettings):
    SECRET_KEY: str = "change-me-in-production"
    DATABASE_URL: str = (
        "postgresql://filmuser:filmpass@localhost:5432/filmanalysis"
    )
    UPLOAD_DIR: str = "uploads"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440
    # Calibration-wizard and Image-page uploads.
    MAX_UPLOAD_SIZE_MB: int = 200
    # Film scans for dose analysis. A 48-bit uncompressed 1200 dpi scan of a
    # 5.5 x 5.7 in film is ~257 MB; 400 covers films up to about 7 x 7 in.
    MAX_FILM_UPLOAD_SIZE_MB: int = 400
    # Calibration patches are averaged over an area, so resolution beyond this
    # adds memory and no precision. Scans above it are block-averaged down.
    CALIBRATION_MAX_DPI: int = 300
    IMAGE_CACHE_TTL_MINUTES: int = 30

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
