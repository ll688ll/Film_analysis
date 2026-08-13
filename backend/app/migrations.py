"""Lightweight startup schema migrations.

``Base.metadata.create_all`` creates missing tables but never alters existing
ones, so columns added to a model after a database already exists would silently
be absent. This module carries the ``ALTER TABLE`` statements that bring an older
database up to the current models.

Every statement must be idempotent -- they run on every startup. To add a column
later, append one line to ``_PG_STATEMENTS`` and add it to the model.

PostgreSQL only: on other dialects (the SQLite test fixture) the schema always
comes from ``create_all`` against a fresh database, so there is nothing to patch.
"""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

# Ordered list of idempotent DDL statements. ``projects`` itself is created by
# create_all, which runs first, so the foreign key below always resolves.
_PG_STATEMENTS: list[str] = [
    # --- analysis_sessions: project folders, image metadata, provenance ---
    "ALTER TABLE analysis_sessions ADD COLUMN IF NOT EXISTS project_id INTEGER "
    "REFERENCES projects(id) ON DELETE SET NULL",
    "ALTER TABLE analysis_sessions ADD COLUMN IF NOT EXISTS image_width INTEGER",
    "ALTER TABLE analysis_sessions ADD COLUMN IF NOT EXISTS image_height INTEGER",
    "ALTER TABLE analysis_sessions ADD COLUMN IF NOT EXISTS image_channels INTEGER",
    "ALTER TABLE analysis_sessions ADD COLUMN IF NOT EXISTS colormap VARCHAR(20) "
    "DEFAULT 'jet'",
    "ALTER TABLE analysis_sessions ADD COLUMN IF NOT EXISTS profile_snapshot JSON",
    "ALTER TABLE analysis_sessions ADD COLUMN IF NOT EXISTS updated_at "
    "TIMESTAMP WITH TIME ZONE",
    # --- roi_measurements: ROI options that were computed but never stored ---
    "ALTER TABLE roi_measurements ADD COLUMN IF NOT EXISTS trim_enabled BOOLEAN "
    "DEFAULT FALSE",
    "ALTER TABLE roi_measurements ADD COLUMN IF NOT EXISTS trim_percent "
    "DOUBLE PRECISION DEFAULT 2.0",
    "ALTER TABLE roi_measurements ADD COLUMN IF NOT EXISTS corner_cut_enabled "
    "BOOLEAN DEFAULT FALSE",
    "ALTER TABLE roi_measurements ADD COLUMN IF NOT EXISTS corner_cut_mm "
    "DOUBLE PRECISION DEFAULT 0.0",
    "ALTER TABLE roi_measurements ADD COLUMN IF NOT EXISTS pixel_count INTEGER",
]


async def run_startup_migrations(conn: AsyncConnection) -> None:
    """Apply pending schema patches. Call after ``create_all``, same transaction."""
    if conn.dialect.name != "postgresql":
        return
    for statement in _PG_STATEMENTS:
        await conn.execute(text(statement))
