"""Film Analysis API -- FastAPI application entry point."""

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import Base, engine
from app.routers import analysis, auth_router, profiles, wizard


async def _cache_cleanup_task(app: FastAPI) -> None:
    """Periodically evict image-cache entries older than the configured TTL."""
    ttl_seconds = settings.IMAGE_CACHE_TTL_MINUTES * 60
    while True:
        await asyncio.sleep(60)  # check every minute
        cache: dict = app.state.image_cache
        now = datetime.now(timezone.utc)
        expired = [
            sid
            for sid, entry in cache.items()
            if (now - entry["last_accessed"]).total_seconds() > ttl_seconds
        ]
        for sid in expired:
            cache.pop(sid, None)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # --- startup ---
    # Ensure upload directory exists
    Path(settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)

    # Create database tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Initialise in-memory image cache
    # Structure per entry:
    #   {
    #       "image_array": np.ndarray,
    #       "dose_map": np.ndarray | None,
    #       "dpi": float,
    #       "last_accessed": datetime (UTC),
    #   }
    app.state.image_cache: dict = {}

    # Launch background cache-cleanup task
    cleanup = asyncio.create_task(_cache_cleanup_task(app))

    yield

    # --- shutdown ---
    cleanup.cancel()
    try:
        await cleanup
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="Film Analysis API",
    version="1.0.0",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# CORS -- allow everything during development
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Width", "X-Height", "X-Dose-Min", "X-Dose-Max", "X-Cmap-Min", "X-Cmap-Max"],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
app.include_router(auth_router.router, prefix="/api")
app.include_router(profiles.router, prefix="/api")
app.include_router(analysis.router, prefix="/api")
app.include_router(wizard.router, prefix="/api")


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
@app.get("/api/health")
async def health_check():
    return {"status": "ok"}
