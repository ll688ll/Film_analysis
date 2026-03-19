from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    SECRET_KEY: str = "change-me-in-production"
    DATABASE_URL: str = (
        "postgresql://filmuser:filmpass@localhost:5432/filmanalysis"
    )
    UPLOAD_DIR: str = "uploads"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440
    MAX_UPLOAD_SIZE_MB: int = 200
    IMAGE_CACHE_TTL_MINUTES: int = 30

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
