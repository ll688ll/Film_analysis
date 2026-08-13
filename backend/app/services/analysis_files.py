"""Ownership of film files belonging to saved analyses.

Uploads land in ``{UPLOAD_DIR}/{user_id}/`` and are transient -- most are never
saved. When an analysis *is* saved it takes a private copy of the scan in
``{UPLOAD_DIR}/{user_id}/saved/`` and owns that copy for its lifetime.

Copying rather than moving keeps the live cache entry's ``file_path`` valid and
gives every "save as new" its own file, so deleting one analysis can never break
another.
"""

from __future__ import annotations

import shutil
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.config import settings

# Grace period before an unclaimed upload is considered abandoned.
ORPHAN_MAX_AGE = timedelta(hours=24)


def user_upload_dir(user_id: int) -> Path:
    return Path(settings.UPLOAD_DIR) / str(user_id)


def saved_dir(user_id: int) -> Path:
    """Directory holding films owned by saved analyses."""
    return user_upload_dir(user_id) / "saved"


def own_file(source: Path | str, user_id: int) -> Path:
    """Copy *source* into the user's saved directory and return the new path.

    Raises
    ------
    FileNotFoundError
        If the source file no longer exists on disk.
    """
    src = Path(source)
    if not src.is_file():
        raise FileNotFoundError(f"Source image is missing: {src}")

    target_dir = saved_dir(user_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    dest = target_dir / f"{uuid.uuid4()}{src.suffix.lower()}"
    shutil.copy2(src, dest)
    return dest


def is_owned(path: Path | str, user_id: int) -> bool:
    """True when *path* lives in the user's saved directory."""
    try:
        Path(path).resolve().relative_to(saved_dir(user_id).resolve())
    except (ValueError, OSError):
        return False
    return True


def delete_owned_file(
    path: Path | str, user_id: int, *, still_referenced: bool
) -> bool:
    """Delete a saved analysis's film file if it is safe to do so.

    Skips files outside the user's saved directory (legacy rows point straight at
    the upload root, which the orphan sweep handles) and files another analysis
    still references. Returns True when a file was removed.
    """
    if still_referenced or not is_owned(path, user_id):
        return False
    try:
        Path(path).unlink()
    except OSError:
        return False
    return True


def cleanup_orphan_uploads(referenced: set[str]) -> int:
    """Delete abandoned uploads, returning how many files were removed.

    An upload is abandoned when it sits directly in ``{UPLOAD_DIR}/{user_id}/``
    (never claimed by a save), is older than :data:`ORPHAN_MAX_AGE`, and is not
    referenced by any analysis. Files under ``saved/`` and the other per-feature
    subdirectories are never touched.
    """
    root = Path(settings.UPLOAD_DIR)
    if not root.is_dir():
        return 0

    referenced_resolved = set()
    for raw in referenced:
        if not raw:
            continue
        try:
            referenced_resolved.add(str(Path(raw).resolve()))
        except OSError:
            continue

    cutoff = datetime.now(timezone.utc) - ORPHAN_MAX_AGE
    removed = 0

    for user_dir in root.iterdir():
        if not user_dir.is_dir() or not user_dir.name.isdigit():
            continue
        for candidate in user_dir.iterdir():
            if not candidate.is_file():
                continue
            try:
                if str(candidate.resolve()) in referenced_resolved:
                    continue
                mtime = datetime.fromtimestamp(
                    candidate.stat().st_mtime, tz=timezone.utc
                )
                if mtime > cutoff:
                    continue
                candidate.unlink()
            except OSError:
                continue
            removed += 1

    return removed
