"""Film Analysis API -- FastAPI application entry point."""

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.config import APP_VERSION, settings
from app.database import Base, async_session, engine
from app.migrations import run_startup_migrations
from app.models import AnalysisSession
from app.routers import analysis, auth_router, imaging, profiles, projects, wizard
from app.services.analysis_files import cleanup_orphan_uploads


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


async def _sweep_orphan_uploads() -> None:
    """Delete stale uploads no saved analysis claimed.

    Runs once per startup rather than on a timer -- the files are only created by
    uploads, and a restart is a natural point to reclaim them.
    """
    try:
        async with async_session() as session:
            result = await session.execute(select(AnalysisSession.stored_filepath))
            referenced = {p for p in result.scalars().all() if p}
        cleanup_orphan_uploads(referenced)
    except Exception:
        # Never block startup on housekeeping.
        pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    # --- startup ---
    # Ensure upload directory exists
    Path(settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)

    # Create database tables, then patch older databases that predate newer columns
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await run_startup_migrations(conn)

    # Initialise in-memory image cache
    # Structure per entry:
    #   {
    #       "image_array": np.ndarray,
    #       "dose_map": np.ndarray | None,
    #       "dpi": float,
    #       "last_accessed": datetime (UTC),
    #   }
    app.state.image_cache: dict = {}

    # Reclaim uploads that were never saved
    await _sweep_orphan_uploads()

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
    version=APP_VERSION,
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
    expose_headers=[
        "X-Width", "X-Height",
        "X-Dose-Min", "X-Dose-Max", "X-Cmap-Min", "X-Cmap-Max",
        # Intensity bin-code plane (app.routers.imaging)
        "X-Int-Bins", "X-Int-Min", "X-Int-Max", "X-Int-Source",
        "X-Int-Format", "X-Int-Downsample", "X-Int-Nodata", "X-Int-Nan-Count",
    ],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
app.include_router(auth_router.router, prefix="/api")
app.include_router(profiles.router, prefix="/api")
app.include_router(projects.router, prefix="/api")
app.include_router(analysis.router, prefix="/api")
app.include_router(imaging.router, prefix="/api")
app.include_router(wizard.router, prefix="/api")


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
@app.get("/api/health")
async def health_check():
    return {"status": "ok", "version": APP_VERSION}
