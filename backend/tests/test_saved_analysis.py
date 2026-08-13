"""Tests for saving, reopening, and managing saved analyses."""

import json
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app

pytestmark = pytest.mark.asyncio


# ---------------------------------------------------------------------------
# Helpers (also used by test_projects.py)
# ---------------------------------------------------------------------------

async def upload_and_calibrate(auth_client: AsyncClient, film_path: str) -> str:
    """Upload the test film, apply a calibration, and return the session id."""
    with open(film_path, "rb") as f:
        resp = await auth_client.post(
            "/api/analysis/upload",
            files={"file": ("CAL_007.tif", f, "image/tiff")},
        )
    assert resp.status_code == 200, resp.text
    session_id = resp.json()["session_id"]

    resp = await auth_client.post(
        f"/api/analysis/{session_id}/calibrate",
        json={"channel": "Red", "a": 0.3, "b": 1.0, "c": -1.0,
              "cmap_min": 0, "cmap_max": 40},
    )
    assert resp.status_code == 200, resp.text
    return session_id


ROI = {
    "roi_type": "Rectangle",
    "x": 100, "y": 120, "w": 200, "h": 150,
    "rotation_deg": 15,
    "hole_ratio": 50,
    "threshold": 0,
    "trim_enabled": True,
    "trim_percent": 3.0,
    "corner_cut_enabled": True,
    "corner_cut_mm": 2.5,
}

STATS = {
    "max": 12.5, "min": 8.1, "mean": 10.2, "std": 0.8,
    "cv": 7.8, "dur": 1.54, "flatness": 21.3,
    "pixel_count": 30000,
    "center_x_mm": 16.9, "center_y_mm": 16.5,
    "width_mm": 16.9, "height_mm": 12.7, "area_mm2": 214.6,
}


async def save_analysis(
    auth_client: AsyncClient, session_id: str, **overrides
) -> dict:
    """Save the session, returning the response JSON."""
    body = {
        "channel": "Red", "a": 0.3, "b": 1.0, "c": -1.0,
        "cmap_min": 0.0, "cmap_max": 40.0,
        "colormap": "viridis",
        "notes": "saved by test",
    }
    body.update(overrides)
    resp = await auth_client.post(f"/api/analysis/{session_id}/save", json=body)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _make_profile(auth_client: AsyncClient, name: str = "EBT3") -> dict:
    resp = await auth_client.post(
        "/api/profiles",
        json={
            "name": name,
            "note": "batch A",
            "primary_channel": "Red",
            "channels": [{"channel": "Red", "a": 0.3, "b": 1.0, "c": -1.0}],
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _second_user_client(client: AsyncClient) -> AsyncClient:
    resp = await client.post(
        "/api/auth/register",
        json={
            "username": "other",
            "email": "other@example.com",
            "password": "otherpass123",
        },
    )
    assert resp.status_code == 201, resp.text
    return AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {resp.json()['access_token']}"},
    )


# ---------------------------------------------------------------------------
# Saving the film data
# ---------------------------------------------------------------------------


async def test_save_records_real_filename_and_dimensions(
    auth_client: AsyncClient, test_film_path: str
):
    session_id = await upload_and_calibrate(auth_client, test_film_path)
    saved = await save_analysis(auth_client, session_id)

    detail = (await auth_client.get(f"/api/analysis/saved/{saved['id']}")).json()
    # Regression: the stored file is named after the session uuid, so the user's
    # own filename used to be lost.
    assert detail["original_filename"] == "CAL_007.tif"
    assert detail["image_width"] > 0
    assert detail["image_height"] > 0
    assert detail["image_channels"] >= 1
    assert detail["colormap"] == "viridis"


async def test_save_copies_film_into_owned_storage(
    auth_client: AsyncClient, test_film_path: str, upload_dir: Path
):
    session_id = await upload_and_calibrate(auth_client, test_film_path)
    saved = await save_analysis(auth_client, session_id)

    owned = list((upload_dir / "1" / "saved").glob("*.tif"))
    assert len(owned) == 1, "the saved analysis should own a copy of the film"
    # The transient upload is left in place; the startup sweep reclaims it.
    assert (upload_dir / "1" / f"{session_id}.tif").is_file()

    detail = (await auth_client.get(f"/api/analysis/saved/{saved['id']}")).json()
    assert detail["has_file"] is True


async def test_save_with_expired_session_returns_404(
    auth_client: AsyncClient, test_film_path: str
):
    session_id = await upload_and_calibrate(auth_client, test_film_path)
    app.state.image_cache.pop(session_id)

    resp = await auth_client.post(
        f"/api/analysis/{session_id}/save",
        json={"channel": "Red", "a": 0.3, "b": 1.0, "c": -1.0},
    )
    assert resp.status_code == 404


async def test_non_numeric_saved_id_is_rejected(auth_client: AsyncClient):
    # Regression: the old export route did int(session_id) and raised a 500.
    resp = await auth_client.get("/api/analysis/saved/not-an-id")
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# ROI and results
# ---------------------------------------------------------------------------


async def test_save_persists_roi_and_stats(
    auth_client: AsyncClient, test_film_path: str
):
    session_id = await upload_and_calibrate(auth_client, test_film_path)
    saved = await save_analysis(auth_client, session_id, roi=ROI, stats=STATS)

    detail = (await auth_client.get(f"/api/analysis/saved/{saved['id']}")).json()
    assert detail["has_roi"] is True
    assert detail["roi"]["x"] == 100
    assert detail["roi"]["rotation_deg"] == 15
    assert detail["roi"]["trim_percent"] == 3.0
    assert detail["roi"]["corner_cut_mm"] == 2.5
    assert detail["stats"]["mean"] == 10.2
    assert detail["stats"]["pixel_count"] == 30000


async def test_export_csv_contains_the_measurement(
    auth_client: AsyncClient, test_film_path: str
):
    session_id = await upload_and_calibrate(auth_client, test_film_path)
    saved = await save_analysis(auth_client, session_id, roi=ROI, stats=STATS)

    resp = await auth_client.get(f"/api/analysis/saved/{saved['id']}/export")
    assert resp.status_code == 200
    lines = [ln for ln in resp.text.splitlines() if not ln.startswith("#")]
    # Regression: ROI rows were never written, so this used to be header-only.
    assert len(lines) == 2
    assert "trim_percent" in lines[0] and "pixel_count" in lines[0]
    assert "10.2" in lines[1]


async def test_non_finite_stats_are_stored_as_null(
    auth_client: AsyncClient, test_film_path: str
):
    session_id = await upload_and_calibrate(auth_client, test_film_path)

    # flatness is inf when the ROI minimum is ~0. Sent as the bare `Infinity`
    # literal, which strict JSON forbids but Python's parser accepts -- storing
    # it would make the row unserializable on the way back out.
    body = json.dumps(
        {"channel": "Red", "a": 0.3, "b": 1.0, "c": -1.0,
         "roi": ROI, "stats": {**STATS, "flatness": float("inf")}}
    )
    resp = await auth_client.post(
        f"/api/analysis/{session_id}/save",
        content=body,
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 200, resp.text

    detail = (
        await auth_client.get(f"/api/analysis/saved/{resp.json()['id']}")
    ).json()
    assert detail["stats"]["flatness"] is None
    assert detail["stats"]["mean"] == 10.2


# ---------------------------------------------------------------------------
# Calibration provenance
# ---------------------------------------------------------------------------


async def test_snapshot_survives_profile_edit(
    auth_client: AsyncClient, test_film_path: str
):
    profile = await _make_profile(auth_client)
    session_id = await upload_and_calibrate(auth_client, test_film_path)
    saved = await save_analysis(auth_client, session_id, profile_id=profile["id"])

    await auth_client.put(
        f"/api/profiles/{profile['id']}",
        json={
            "name": "EBT3 revised",
            "channels": [{"channel": "Red", "a": 9.9, "b": 9.9, "c": 9.9}],
        },
    )

    detail = (await auth_client.get(f"/api/analysis/saved/{saved['id']}")).json()
    snapshot = detail["profile_snapshot"]
    assert snapshot["profile_name"] == "EBT3"
    assert snapshot["channels"][0]["a"] == 0.3
    assert snapshot["applied"]["a"] == 0.3


async def test_snapshot_survives_profile_delete(
    auth_client: AsyncClient, test_film_path: str
):
    profile = await _make_profile(auth_client)
    session_id = await upload_and_calibrate(auth_client, test_film_path)
    saved = await save_analysis(auth_client, session_id, profile_id=profile["id"])

    await auth_client.delete(f"/api/profiles/{profile['id']}")

    history = (await auth_client.get("/api/analysis/history")).json()
    row = next(r for r in history if r["id"] == saved["id"])
    # Regression: the history Profile column used to render "N/A" for every row.
    assert row["profile"]["name"] == "EBT3"
    assert row["profile"]["deleted"] is True
    assert row["profile_id"] is None


async def test_update_keeps_the_original_snapshot(
    auth_client: AsyncClient, test_film_path: str
):
    """Continuing a study must not re-snapshot a profile edited since the save."""
    profile = await _make_profile(auth_client)
    session_id = await upload_and_calibrate(auth_client, test_film_path)
    saved = await save_analysis(
        auth_client, session_id, profile_id=profile["id"], roi=ROI, stats=STATS
    )

    await auth_client.put(
        f"/api/profiles/{profile['id']}",
        json={
            "name": "EBT3 recalibrated",
            "channels": [{"channel": "Red", "a": 9.9, "b": 9.9, "c": 9.9}],
        },
    )

    # Reopen and re-save with the coefficients that were restored.
    await save_analysis(
        auth_client,
        session_id,
        profile_id=profile["id"],
        analysis_id=saved["id"],
        roi={**ROI, "x": 400},
        stats=STATS,
    )

    detail = (await auth_client.get(f"/api/analysis/saved/{saved['id']}")).json()
    assert detail["profile_snapshot"]["profile_name"] == "EBT3"
    assert detail["profile_snapshot"]["channels"][0]["a"] == 0.3


async def test_update_resnapshots_when_the_calibration_changes(
    auth_client: AsyncClient, test_film_path: str
):
    first = await _make_profile(auth_client, name="First")
    second = await _make_profile(auth_client, name="Second")
    session_id = await upload_and_calibrate(auth_client, test_film_path)
    saved = await save_analysis(auth_client, session_id, profile_id=first["id"])

    await save_analysis(
        auth_client,
        session_id,
        profile_id=second["id"],
        analysis_id=saved["id"],
    )

    detail = (await auth_client.get(f"/api/analysis/saved/{saved['id']}")).json()
    assert detail["profile_snapshot"]["profile_name"] == "Second"


async def test_snapshot_without_profile_keeps_applied_coefficients(
    auth_client: AsyncClient, test_film_path: str
):
    session_id = await upload_and_calibrate(auth_client, test_film_path)
    saved = await save_analysis(auth_client, session_id, a=0.42)

    detail = (await auth_client.get(f"/api/analysis/saved/{saved['id']}")).json()
    assert detail["profile_snapshot"]["applied"]["a"] == 0.42


# ---------------------------------------------------------------------------
# Reopening
# ---------------------------------------------------------------------------


async def test_open_returns_a_usable_session(
    auth_client: AsyncClient, test_film_path: str
):
    session_id = await upload_and_calibrate(auth_client, test_film_path)
    saved = await save_analysis(auth_client, session_id, roi=ROI, stats=STATS)

    # Simulate the cache having expired since the save.
    app.state.image_cache.clear()

    resp = await auth_client.post(f"/api/analysis/saved/{saved['id']}/open")
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["session_id"] != session_id
    assert payload["roi"]["x"] == 100
    assert payload["width"] > 0

    new_session = payload["session_id"]
    assert (
        await auth_client.get(f"/api/analysis/{new_session}/preview")
    ).status_code == 200

    resp = await auth_client.post(
        f"/api/analysis/{new_session}/calibrate",
        json={"channel": payload["channel"], "a": payload["a"],
              "b": payload["b"], "c": payload["c"]},
    )
    assert resp.status_code == 200


async def test_open_with_missing_file_returns_410(
    auth_client: AsyncClient, test_film_path: str, upload_dir: Path
):
    session_id = await upload_and_calibrate(auth_client, test_film_path)
    saved = await save_analysis(auth_client, session_id)

    for f in (upload_dir / "1" / "saved").glob("*"):
        f.unlink()

    resp = await auth_client.post(f"/api/analysis/saved/{saved['id']}/open")
    assert resp.status_code == 410

    history = (await auth_client.get("/api/analysis/history")).json()
    assert history[0]["has_file"] is False


async def test_download_original_film(
    auth_client: AsyncClient, test_film_path: str
):
    session_id = await upload_and_calibrate(auth_client, test_film_path)
    saved = await save_analysis(auth_client, session_id)

    resp = await auth_client.get(f"/api/analysis/saved/{saved['id']}/file")
    assert resp.status_code == 200
    assert "CAL_007.tif" in resp.headers["content-disposition"]
    assert len(resp.content) == Path(test_film_path).stat().st_size


# ---------------------------------------------------------------------------
# Update vs. save-as-new
# ---------------------------------------------------------------------------


async def test_update_existing_analysis_in_place(
    auth_client: AsyncClient, test_film_path: str
):
    session_id = await upload_and_calibrate(auth_client, test_film_path)
    saved = await save_analysis(auth_client, session_id, roi=ROI, stats=STATS)

    moved = {**ROI, "x": 400, "y": 450}
    again = await save_analysis(
        auth_client,
        session_id,
        analysis_id=saved["id"],
        roi=moved,
        stats=STATS,
        notes="continued",
    )
    assert again["id"] == saved["id"]

    detail = (await auth_client.get(f"/api/analysis/saved/{saved['id']}")).json()
    assert detail["roi"]["x"] == 400
    assert detail["notes"] == "continued"
    assert detail["updated_at"] is not None
    assert len((await auth_client.get("/api/analysis/history")).json()) == 1

    # The measurement was replaced rather than appended.
    csv_rows = [
        ln
        for ln in (
            await auth_client.get(f"/api/analysis/saved/{saved['id']}/export")
        ).text.splitlines()
        if ln and not ln.startswith("#")
    ]
    assert len(csv_rows) == 2


async def test_save_as_new_creates_an_independent_record(
    auth_client: AsyncClient, test_film_path: str, upload_dir: Path
):
    session_id = await upload_and_calibrate(auth_client, test_film_path)
    first = await save_analysis(auth_client, session_id, roi=ROI, stats=STATS)
    second = await save_analysis(auth_client, session_id, roi=ROI, stats=STATS)

    assert first["id"] != second["id"]
    assert len(list((upload_dir / "1" / "saved").glob("*.tif"))) == 2

    # Deleting one must not disturb the other's film.
    assert (
        await auth_client.delete(f"/api/analysis/saved/{first['id']}")
    ).status_code == 204
    assert len(list((upload_dir / "1" / "saved").glob("*.tif"))) == 1
    detail = (await auth_client.get(f"/api/analysis/saved/{second['id']}")).json()
    assert detail["has_file"] is True


async def test_update_requires_an_owned_analysis(
    auth_client: AsyncClient, client: AsyncClient, test_film_path: str
):
    session_id = await upload_and_calibrate(auth_client, test_film_path)
    saved = await save_analysis(auth_client, session_id)

    async with await _second_user_client(client) as other:
        other_session = await upload_and_calibrate(other, test_film_path)
        resp = await other.post(
            f"/api/analysis/{other_session}/save",
            json={"channel": "Red", "a": 0.3, "b": 1.0, "c": -1.0,
                  "analysis_id": saved["id"]},
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Delete, notes, and project membership
# ---------------------------------------------------------------------------


async def test_delete_removes_record_and_film(
    auth_client: AsyncClient, test_film_path: str, upload_dir: Path
):
    session_id = await upload_and_calibrate(auth_client, test_film_path)
    saved = await save_analysis(auth_client, session_id, roi=ROI, stats=STATS)

    resp = await auth_client.delete(f"/api/analysis/saved/{saved['id']}")
    assert resp.status_code == 204
    assert (await auth_client.get("/api/analysis/history")).json() == []
    assert list((upload_dir / "1" / "saved").glob("*.tif")) == []


async def test_patch_notes_and_project(
    auth_client: AsyncClient, test_film_path: str
):
    project = (
        await auth_client.post("/api/projects", json={"name": "Filed"})
    ).json()
    session_id = await upload_and_calibrate(auth_client, test_film_path)
    saved = await save_analysis(auth_client, session_id)

    resp = await auth_client.patch(
        f"/api/analysis/saved/{saved['id']}",
        json={"notes": "revised note", "project_id": project["id"]},
    )
    assert resp.status_code == 200
    assert resp.json()["notes"] == "revised note"
    assert resp.json()["project_id"] == project["id"]

    resp = await auth_client.patch(
        f"/api/analysis/saved/{saved['id']}", json={"clear_project": True}
    )
    assert resp.json()["project_id"] is None


async def test_patch_rejects_another_users_project(
    auth_client: AsyncClient, client: AsyncClient, test_film_path: str
):
    session_id = await upload_and_calibrate(auth_client, test_film_path)
    saved = await save_analysis(auth_client, session_id)

    async with await _second_user_client(client) as other:
        foreign = (
            await other.post("/api/projects", json={"name": "Theirs"})
        ).json()

    resp = await auth_client.patch(
        f"/api/analysis/saved/{saved['id']}", json={"project_id": foreign["id"]}
    )
    assert resp.status_code == 404


async def test_saving_into_another_users_project_is_rejected(
    auth_client: AsyncClient, client: AsyncClient, test_film_path: str
):
    async with await _second_user_client(client) as other:
        foreign = (
            await other.post("/api/projects", json={"name": "Theirs"})
        ).json()

    session_id = await upload_and_calibrate(auth_client, test_film_path)
    resp = await auth_client.post(
        f"/api/analysis/{session_id}/save",
        json={"channel": "Red", "a": 0.3, "b": 1.0, "c": -1.0,
              "project_id": foreign["id"]},
    )
    assert resp.status_code == 404


async def test_saved_analyses_are_per_user(
    auth_client: AsyncClient, client: AsyncClient, test_film_path: str
):
    session_id = await upload_and_calibrate(auth_client, test_film_path)
    saved = await save_analysis(auth_client, session_id)

    async with await _second_user_client(client) as other:
        for call in (
            other.get(f"/api/analysis/saved/{saved['id']}"),
            other.post(f"/api/analysis/saved/{saved['id']}/open"),
            other.delete(f"/api/analysis/saved/{saved['id']}"),
            other.get(f"/api/analysis/saved/{saved['id']}/export"),
        ):
            assert (await call).status_code == 404
