"""Shared access to the in-memory image session cache.

The cache lives on ``app.state.image_cache`` (created in :mod:`app.main`) and
maps a uuid *session_id* to a dict::

    {
        "image_array": np.ndarray,
        "dose_map": np.ndarray | None,
        "dpi": float,
        "last_accessed": datetime (UTC),
        "file_path": str,
        "user_id": int,
    }

Entries created by the imaging router carry additional keys (``has_dpi``,
``alpha``, ``mode``, ...); consumers should use ``.get()`` for those.
"""

import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException, Request, UploadFile, status
from fastapi.concurrency import run_in_threadpool

from app.config import settings

_COPY_CHUNK = 1024 * 1024


class _UploadTooLarge(Exception):
    pass


def _copy_within_limit(src, dst: Path, limit: int) -> int:
    """Copy *src* to *dst* a chunk at a time, stopping once *limit* is passed."""
    src.seek(0)
    written = 0
    with dst.open("wb") as out:
        while True:
            chunk = src.read(_COPY_CHUNK)
            if not chunk:
                break
            written += len(chunk)
            if written > limit:
                raise _UploadTooLarge
            out.write(chunk)
    return written


def get_cache_entry(
    request: Request,
    session_id: str,
    user_id: int,
    detail: str = "Session not found or expired",
) -> dict:
    """
    Fetch a cache entry, verifying it belongs to *user_id*.

    A session owned by another user is reported as missing rather than
    forbidden, so the endpoint does not confirm that the id exists.

    Raises
    ------
    HTTPException
        404 if the session is absent, expired, or owned by another user.
    """
    cache: dict = request.app.state.image_cache
    entry = cache.get(session_id)
    if entry is None or entry.get("user_id") != user_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail,
        )
    entry["last_accessed"] = datetime.now(timezone.utc)
    return entry


async def save_upload(
    file: UploadFile,
    user_id: int,
    allowed_extensions: set[str],
    subdir: str | None = None,
    max_mb: int | None = None,
) -> tuple[str, Path]:
    """
    Validate and persist an uploaded file.

    Returns ``(session_id, save_path)``. The caller is responsible for loading
    the image and calling :func:`put_cache_entry`.

    *max_mb* defaults to ``settings.MAX_UPLOAD_SIZE_MB``; the film path passes
    its larger limit. The body is copied to disk in 1 MB chunks rather than
    read into memory first, so a 257 MB scan no longer costs 257 MB of RAM
    on top of the decoded array.

    Raises
    ------
    HTTPException
        400 for an unsupported extension, 413 when over the size limit.
    """
    limit_mb = settings.MAX_UPLOAD_SIZE_MB if max_mb is None else max_mb
    limit = limit_mb * 1024 * 1024
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in allowed_extensions:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Unsupported file type '{suffix}'. "
                f"Allowed: {', '.join(sorted(allowed_extensions))}"
            ),
        )

    too_large = HTTPException(
        status_code=status.HTTP_413_CONTENT_TOO_LARGE,
        detail=f"File exceeds {limit_mb} MB limit",
    )
    # The multipart parser records each part's size; refuse before copying.
    if file.size is not None and file.size > limit:
        raise too_large

    target_dir = Path(settings.UPLOAD_DIR) / str(user_id)
    if subdir:
        target_dir = target_dir / subdir
    target_dir.mkdir(parents=True, exist_ok=True)

    session_id = str(uuid.uuid4())
    save_path = target_dir / f"{session_id}{suffix}"
    try:
        await run_in_threadpool(_copy_within_limit, file.file, save_path, limit)
    except _UploadTooLarge:
        save_path.unlink(missing_ok=True)
        raise too_large

    return session_id, save_path


def put_cache_entry(
    request: Request,
    session_id: str,
    *,
    image_array,
    dpi: float,
    file_path: str,
    user_id: int,
    **extra,
) -> dict:
    """Create and store a cache entry, returning it."""
    entry = {
        "image_array": image_array,
        "dose_map": None,
        "dpi": dpi,
        "last_accessed": datetime.now(timezone.utc),
        "file_path": file_path,
        "user_id": user_id,
        **extra,
    }
    cache: dict = request.app.state.image_cache
    cache[session_id] = entry
    return entry
