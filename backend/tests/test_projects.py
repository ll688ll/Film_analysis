"""Tests for the project (analysis folder) endpoints."""

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app

pytestmark = pytest.mark.asyncio


async def _second_user_client(client: AsyncClient) -> AsyncClient:
    """Register a second user and return an authenticated client for them."""
    resp = await client.post(
        "/api/auth/register",
        json={
            "username": "other",
            "email": "other@example.com",
            "password": "otherpass123",
        },
    )
    assert resp.status_code == 201, resp.text
    token = resp.json()["access_token"]
    return AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {token}"},
    )


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


async def test_create_and_list_project(auth_client: AsyncClient):
    resp = await auth_client.post(
        "/api/projects", json={"name": "Head & Neck", "description": "QA films"}
    )
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["name"] == "Head & Neck"
    assert created["description"] == "QA films"
    assert created["analysis_count"] == 0

    resp = await auth_client.get("/api/projects")
    assert resp.status_code == 200
    assert [p["name"] for p in resp.json()] == ["Head & Neck"]


async def test_create_duplicate_name_conflicts(auth_client: AsyncClient):
    await auth_client.post("/api/projects", json={"name": "Weekly QA"})
    resp = await auth_client.post("/api/projects", json={"name": "Weekly QA"})
    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]


async def test_create_rejects_blank_name(auth_client: AsyncClient):
    resp = await auth_client.post("/api/projects", json={"name": "   "})
    assert resp.status_code == 422


async def test_rename_project(auth_client: AsyncClient):
    created = (
        await auth_client.post("/api/projects", json={"name": "Old"})
    ).json()

    resp = await auth_client.put(
        f"/api/projects/{created['id']}", json={"name": "New"}
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "New"


async def test_rename_to_existing_name_conflicts(auth_client: AsyncClient):
    await auth_client.post("/api/projects", json={"name": "First"})
    second = (
        await auth_client.post("/api/projects", json={"name": "Second"})
    ).json()

    resp = await auth_client.put(
        f"/api/projects/{second['id']}", json={"name": "First"}
    )
    assert resp.status_code == 409


async def test_rename_to_own_name_is_allowed(auth_client: AsyncClient):
    created = (
        await auth_client.post("/api/projects", json={"name": "Same"})
    ).json()

    resp = await auth_client.put(
        f"/api/projects/{created['id']}",
        json={"name": "Same", "description": "updated"},
    )
    assert resp.status_code == 200
    assert resp.json()["description"] == "updated"


async def test_delete_project(auth_client: AsyncClient):
    created = (
        await auth_client.post("/api/projects", json={"name": "Temp"})
    ).json()

    resp = await auth_client.delete(f"/api/projects/{created['id']}")
    assert resp.status_code == 204
    assert (await auth_client.get("/api/projects")).json() == []


async def test_projects_require_auth(client: AsyncClient):
    assert (await client.get("/api/projects")).status_code == 401


# ---------------------------------------------------------------------------
# Isolation between users
# ---------------------------------------------------------------------------


async def test_projects_are_per_user(auth_client: AsyncClient, client: AsyncClient):
    mine = (
        await auth_client.post("/api/projects", json={"name": "Mine"})
    ).json()

    async with await _second_user_client(client) as other:
        # The other user sees an empty list and cannot reach my project...
        assert (await other.get("/api/projects")).json() == []
        assert (await other.put(
            f"/api/projects/{mine['id']}", json={"name": "Hijacked"}
        )).status_code == 404
        assert (
            await other.delete(f"/api/projects/{mine['id']}")
        ).status_code == 404

        # ...and can reuse the same name, since uniqueness is scoped per user.
        assert (
            await other.post("/api/projects", json={"name": "Mine"})
        ).status_code == 201


# ---------------------------------------------------------------------------
# Relationship with saved analyses
# ---------------------------------------------------------------------------


async def test_analysis_count_reflects_saved_analyses(
    auth_client: AsyncClient, test_film_path: str
):
    from tests.test_saved_analysis import save_analysis, upload_and_calibrate

    project = (
        await auth_client.post("/api/projects", json={"name": "Counted"})
    ).json()
    session_id = await upload_and_calibrate(auth_client, test_film_path)
    await save_analysis(auth_client, session_id, project_id=project["id"])

    projects = (await auth_client.get("/api/projects")).json()
    assert projects[0]["analysis_count"] == 1


async def test_deleting_project_unfiles_its_analyses(
    auth_client: AsyncClient, test_film_path: str
):
    from tests.test_saved_analysis import save_analysis, upload_and_calibrate

    project = (
        await auth_client.post("/api/projects", json={"name": "Doomed"})
    ).json()
    session_id = await upload_and_calibrate(auth_client, test_film_path)
    saved = await save_analysis(auth_client, session_id, project_id=project["id"])

    resp = await auth_client.delete(f"/api/projects/{project['id']}")
    assert resp.status_code == 204

    # The analysis survives, unfiled rather than deleted.
    detail = (await auth_client.get(f"/api/analysis/saved/{saved['id']}")).json()
    assert detail["project_id"] is None
