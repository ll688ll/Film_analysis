"""Project (analysis folder) CRUD endpoints."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models import AnalysisSession, Project, User

router = APIRouter(prefix="/projects", tags=["projects"])


# ---------------------------------------------------------------------------
# Request / response schemas local to this router
# ---------------------------------------------------------------------------

class ProjectCreate(BaseModel):
    name: str
    description: str | None = None


class ProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class ProjectOut(BaseModel):
    id: int
    name: str
    description: str = ""
    analysis_count: int = 0
    created_at: datetime | None = None
    updated_at: datetime | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def get_user_project(
    project_id: int, user_id: int, db: AsyncSession
) -> Project:
    """Fetch a project owned by *user_id*, or raise 404.

    A project owned by another user is reported as missing rather than
    forbidden, matching the convention in ``session_cache.get_cache_entry``.
    """
    result = await db.execute(
        select(Project).where(
            Project.id == project_id, Project.user_id == user_id
        )
    )
    project = result.scalars().first()
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    return project


def _serialize(project: Project, analysis_count: int = 0) -> ProjectOut:
    return ProjectOut(
        id=project.id,
        name=project.name,
        description=project.description or "",
        analysis_count=analysis_count,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


async def _reject_duplicate_name(
    name: str, user_id: int, db: AsyncSession, exclude_id: int | None = None
) -> None:
    stmt = select(Project.id).where(
        Project.user_id == user_id, Project.name == name
    )
    if exclude_id is not None:
        stmt = stmt.where(Project.id != exclude_id)
    if (await db.execute(stmt)).scalars().first() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A project named '{name}' already exists",
        )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("", response_model=list[ProjectOut])
async def list_projects(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    counts = dict(
        (
            await db.execute(
                select(
                    AnalysisSession.project_id,
                    func.count(AnalysisSession.id),
                )
                .where(AnalysisSession.user_id == current_user.id)
                .group_by(AnalysisSession.project_id)
            )
        ).all()
    )

    result = await db.execute(
        select(Project)
        .where(Project.user_id == current_user.id)
        .order_by(Project.name)
    )
    return [
        _serialize(p, counts.get(p.id, 0)) for p in result.scalars().all()
    ]


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
async def create_project(
    body: ProjectCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    name = body.name.strip()
    if not name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Project name cannot be empty",
        )
    await _reject_duplicate_name(name, current_user.id, db)

    project = Project(
        user_id=current_user.id,
        name=name,
        description=(body.description or "").strip(),
    )
    db.add(project)
    try:
        await db.flush()
    except IntegrityError:
        # Lost a race against a concurrent create with the same name.
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A project named '{name}' already exists",
        )
    await db.refresh(project)
    return _serialize(project)


@router.put("/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: int,
    body: ProjectUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_user_project(project_id, current_user.id, db)

    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Project name cannot be empty",
            )
        await _reject_duplicate_name(
            name, current_user.id, db, exclude_id=project.id
        )
        project.name = name
    if body.description is not None:
        project.description = body.description.strip()

    await db.flush()
    await db.refresh(project)

    count = (
        await db.execute(
            select(func.count(AnalysisSession.id)).where(
                AnalysisSession.project_id == project.id
            )
        )
    ).scalar_one()
    return _serialize(project, count)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a project. Its analyses are unfiled, never deleted."""
    project = await get_user_project(project_id, current_user.id, db)

    # Explicit unfile rather than relying on ON DELETE SET NULL: SQLite (used by
    # the test suite) does not enforce foreign key actions by default.
    await db.execute(
        update(AnalysisSession)
        .where(
            AnalysisSession.project_id == project.id,
            AnalysisSession.user_id == current_user.id,
        )
        .values(project_id=None)
    )
    await db.delete(project)
