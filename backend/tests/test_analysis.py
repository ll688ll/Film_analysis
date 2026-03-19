"""Tests for the analysis workflow endpoints."""

import io

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _upload_film(auth_client: AsyncClient, film_path: str) -> dict:
    """Upload the test film and return the JSON response."""
    with open(film_path, "rb") as f:
        resp = await auth_client.post(
            "/api/analysis/upload",
            files={"file": ("CAL_007.tif", f, "image/tiff")},
        )
    assert resp.status_code == 200, f"Upload failed: {resp.text}"
    return resp.json()


async def _calibrate(auth_client: AsyncClient, session_id: str) -> dict:
    """Apply calibration and return the JSON response."""
    resp = await auth_client.post(
        f"/api/analysis/{session_id}/calibrate",
        json={
            "channel": "Red",
            "a": 0.3,
            "b": 1.0,
            "c": -1.0,
            "cmap_min": 0,
            "cmap_max": 40,
        },
    )
    assert resp.status_code == 200, f"Calibrate failed: {resp.text}"
    return resp.json()


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------


async def test_upload_image(auth_client: AsyncClient, test_film_path: str):
    data = await _upload_film(auth_client, test_film_path)
    assert "session_id" in data
    assert data["width"] > 0
    assert data["height"] > 0
    assert data["dpi"] > 0
    assert data["filename"] == "CAL_007.tif"


async def test_upload_unsupported_extension(auth_client: AsyncClient):
    fake_file = io.BytesIO(b"not an image")
    resp = await auth_client.post(
        "/api/analysis/upload",
        files={"file": ("bad.bmp", fake_file, "image/bmp")},
    )
    assert resp.status_code == 400
    assert "Unsupported file type" in resp.json()["detail"]


async def test_upload_requires_auth(client: AsyncClient, test_film_path: str):
    with open(test_film_path, "rb") as f:
        resp = await client.post(
            "/api/analysis/upload",
            files={"file": ("CAL_007.tif", f, "image/tiff")},
        )
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------


async def test_preview_after_upload(auth_client: AsyncClient, test_film_path: str):
    upload_data = await _upload_film(auth_client, test_film_path)
    session_id = upload_data["session_id"]

    resp = await auth_client.get(f"/api/analysis/{session_id}/preview")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/jpeg"
    # Verify JPEG magic bytes
    assert resp.content[:2] == b"\xff\xd8"


async def test_preview_missing_session(auth_client: AsyncClient):
    resp = await auth_client.get("/api/analysis/nonexistent-id/preview")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Calibrate
# ---------------------------------------------------------------------------


async def test_calibrate(auth_client: AsyncClient, test_film_path: str):
    upload_data = await _upload_film(auth_client, test_film_path)
    session_id = upload_data["session_id"]

    cal_data = await _calibrate(auth_client, session_id)
    assert cal_data["session_id"] == session_id
    assert "dose_min" in cal_data
    assert "dose_max" in cal_data
    assert "dose_mean" in cal_data


# ---------------------------------------------------------------------------
# Dose map preview
# ---------------------------------------------------------------------------


async def test_dose_preview_after_calibration(
    auth_client: AsyncClient, test_film_path: str
):
    upload_data = await _upload_film(auth_client, test_film_path)
    session_id = upload_data["session_id"]
    await _calibrate(auth_client, session_id)

    resp = await auth_client.get(f"/api/analysis/{session_id}/dose-preview")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    # PNG magic bytes
    assert resp.content[:4] == b"\x89PNG"


async def test_dose_preview_before_calibration(
    auth_client: AsyncClient, test_film_path: str
):
    upload_data = await _upload_film(auth_client, test_film_path)
    session_id = upload_data["session_id"]

    resp = await auth_client.get(f"/api/analysis/{session_id}/dose-preview")
    assert resp.status_code == 400
    assert "Calibration has not been applied" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# ROI stats
# ---------------------------------------------------------------------------


async def test_roi_rectangle(auth_client: AsyncClient, test_film_path: str):
    upload_data = await _upload_film(auth_client, test_film_path)
    session_id = upload_data["session_id"]
    await _calibrate(auth_client, session_id)

    resp = await auth_client.post(
        f"/api/analysis/{session_id}/roi",
        json={
            "roi_type": "Rectangle",
            "x": 10,
            "y": 10,
            "w": 50,
            "h": 50,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "max" in data
    assert "min" in data
    assert "mean" in data
    assert "std" in data
    assert "pixel_count" in data
    assert data["pixel_count"] > 0
    assert data["roi_type"] == "Rectangle"


async def test_roi_circle(auth_client: AsyncClient, test_film_path: str):
    upload_data = await _upload_film(auth_client, test_film_path)
    session_id = upload_data["session_id"]
    await _calibrate(auth_client, session_id)

    resp = await auth_client.post(
        f"/api/analysis/{session_id}/roi",
        json={
            "roi_type": "Circle",
            "x": 10,
            "y": 10,
            "w": 60,
            "h": 60,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["pixel_count"] > 0
    assert data["roi_type"] == "Circle"


async def test_roi_before_calibration(auth_client: AsyncClient, test_film_path: str):
    upload_data = await _upload_film(auth_client, test_film_path)
    session_id = upload_data["session_id"]

    resp = await auth_client.post(
        f"/api/analysis/{session_id}/roi",
        json={
            "roi_type": "Rectangle",
            "x": 10, "y": 10, "w": 50, "h": 50,
        },
    )
    assert resp.status_code == 400
    assert "Calibration has not been applied" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# Save & History
# ---------------------------------------------------------------------------


async def test_save_analysis(auth_client: AsyncClient, test_film_path: str):
    upload_data = await _upload_film(auth_client, test_film_path)
    session_id = upload_data["session_id"]
    await _calibrate(auth_client, session_id)

    resp = await auth_client.post(
        f"/api/analysis/{session_id}/save",
        json={
            "channel": "Red",
            "a": 0.3,
            "b": 1.0,
            "c": -1.0,
            "notes": "test save",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "id" in data
    assert data["original_filename"].endswith(".tif")


async def test_analysis_history(auth_client: AsyncClient, test_film_path: str):
    # Save one analysis first
    upload_data = await _upload_film(auth_client, test_film_path)
    session_id = upload_data["session_id"]
    await _calibrate(auth_client, session_id)
    await auth_client.post(
        f"/api/analysis/{session_id}/save",
        json={"channel": "Red", "a": 0.3, "b": 1.0, "c": -1.0},
    )

    resp = await auth_client.get("/api/analysis/history")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    assert "id" in data[0]
    assert "original_filename" in data[0]
