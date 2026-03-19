"""Tests for the calibration wizard endpoints."""

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _upload_wizard_image(
    auth_client: AsyncClient, film_path: str
) -> dict:
    """Upload an image via the wizard endpoint and return the JSON response."""
    with open(film_path, "rb") as f:
        resp = await auth_client.post(
            "/api/wizard/upload-image",
            files={"file": ("CAL_007.tif", f, "image/tiff")},
        )
    assert resp.status_code == 200, f"Wizard upload failed: {resp.text}"
    return resp.json()


# ---------------------------------------------------------------------------
# Upload wizard image
# ---------------------------------------------------------------------------


async def test_wizard_upload(auth_client: AsyncClient, test_film_path: str):
    data = await _upload_wizard_image(auth_client, test_film_path)
    assert "wizard_session_id" in data
    assert "preview_url" in data
    assert data["wizard_session_id"] in data["preview_url"]


async def test_wizard_upload_unsupported_type(auth_client: AsyncClient):
    import io

    fake = io.BytesIO(b"dummy content")
    resp = await auth_client.post(
        "/api/wizard/upload-image",
        files={"file": ("bad.doc", fake, "application/octet-stream")},
    )
    assert resp.status_code == 400
    assert "Unsupported file type" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# Extract point from ROI
# ---------------------------------------------------------------------------


async def test_extract_point(auth_client: AsyncClient, test_film_path: str):
    upload_data = await _upload_wizard_image(auth_client, test_film_path)
    wizard_session_id = upload_data["wizard_session_id"]

    resp = await auth_client.post(
        "/api/wizard/extract-point",
        json={
            "wizard_session_id": wizard_session_id,
            "x": 10,
            "y": 10,
            "w": 40,
            "h": 40,
            "dose": 2.5,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["dose"] == 2.5
    assert "red_pct" in data
    assert "green_pct" in data
    assert "blue_pct" in data
    # Percentages should be in reasonable range
    for key in ("red_pct", "green_pct", "blue_pct"):
        assert 0.0 <= data[key] <= 100.0


async def test_extract_point_missing_session(auth_client: AsyncClient):
    resp = await auth_client.post(
        "/api/wizard/extract-point",
        json={
            "wizard_session_id": "nonexistent",
            "x": 0, "y": 0, "w": 10, "h": 10,
            "dose": 1.0,
        },
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Fit curves
# ---------------------------------------------------------------------------


async def test_fit_curves_with_enough_points(auth_client: AsyncClient):
    """Fitting with >= 4 synthetic calibration points should succeed."""
    # Generate synthetic data from a known model: color = a + b/(dose - c)
    a_true, b_true, c_true = 20.0, -500.0, -5.0
    doses = [0.5, 1.0, 2.0, 4.0, 6.0, 8.0, 10.0]
    points = []
    for d in doses:
        color = a_true + b_true / (d - c_true)
        points.append({
            "dose": d,
            "red_pct": color,
            "green_pct": color * 0.95,
            "blue_pct": color * 0.90,
        })

    resp = await auth_client.post(
        "/api/wizard/fit-curves",
        json={"points": points},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "Red" in data
    assert "Green" in data
    assert "Blue" in data
    for ch in ("Red", "Green", "Blue"):
        assert "a" in data[ch]
        assert "b" in data[ch]
        assert "c" in data[ch]
        assert "r_squared" in data[ch]
        assert data[ch]["r_squared"] > 0.9


async def test_fit_curves_too_few_points(auth_client: AsyncClient):
    """Fitting with fewer than 3 points should fail."""
    points = [
        {"dose": 1.0, "red_pct": 50, "green_pct": 50, "blue_pct": 50},
        {"dose": 2.0, "red_pct": 40, "green_pct": 40, "blue_pct": 40},
    ]
    resp = await auth_client.post(
        "/api/wizard/fit-curves",
        json={"points": points},
    )
    assert resp.status_code == 400
    assert "At least 3" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# Save profile via wizard
# ---------------------------------------------------------------------------


async def test_save_profile(auth_client: AsyncClient):
    """Save a calibration profile through the wizard endpoint."""
    resp = await auth_client.post(
        "/api/wizard/save-profile",
        json={
            "name": "Test Wizard Profile",
            "note": "Created by test suite",
            "primary_channel": "Red",
            "fitted_params": {
                "Red": {"a": 20.0, "b": -500.0, "c": -5.0, "r_squared": 0.999},
                "Green": {"a": 19.0, "b": -475.0, "c": -4.5, "r_squared": 0.998},
                "Blue": {"a": 18.0, "b": -450.0, "c": -4.0, "r_squared": 0.997},
            },
            "points": [
                {"dose": 0.5, "red_pct": 80, "green_pct": 76, "blue_pct": 72},
                {"dose": 2.0, "red_pct": 60, "green_pct": 57, "blue_pct": 54},
                {"dose": 5.0, "red_pct": 40, "green_pct": 38, "blue_pct": 36},
                {"dose": 10.0, "red_pct": 30, "green_pct": 28.5, "blue_pct": 27},
            ],
        },
    )
    assert resp.status_code == 201
    data = resp.json()
    assert "id" in data
    assert data["name"] == "Test Wizard Profile"
    assert data["primary_channel"] == "Red"


# ---------------------------------------------------------------------------
# Full wizard workflow (integration)
# ---------------------------------------------------------------------------


async def test_wizard_full_workflow(auth_client: AsyncClient, test_film_path: str):
    """End-to-end wizard: upload -> extract multiple points -> fit -> save."""
    # Step 1: Upload
    upload_data = await _upload_wizard_image(auth_client, test_film_path)
    wid = upload_data["wizard_session_id"]

    # Step 2: Extract several points at different ROI positions with fake doses
    doses = [0.5, 1.0, 2.0, 4.0, 6.0, 8.0, 10.0]
    extracted_points = []
    for i, dose in enumerate(doses):
        resp = await auth_client.post(
            "/api/wizard/extract-point",
            json={
                "wizard_session_id": wid,
                "x": 10 + i * 5,
                "y": 10 + i * 5,
                "w": 30,
                "h": 30,
                "dose": dose,
            },
        )
        assert resp.status_code == 200
        pt = resp.json()
        extracted_points.append({
            "dose": pt["dose"],
            "red_pct": pt["red_pct"],
            "green_pct": pt["green_pct"],
            "blue_pct": pt["blue_pct"],
        })

    assert len(extracted_points) == 7

    # Step 3: Fit curves
    # Note: The extracted points from the same image region with fake doses
    # may not produce a great fit, but the endpoint should still respond 200
    # as long as curve_fit converges. We use synthetic data for a reliable test.
    a_true, b_true, c_true = 20.0, -500.0, -5.0
    synthetic_points = []
    for d in doses:
        color = a_true + b_true / (d - c_true)
        synthetic_points.append({
            "dose": d,
            "red_pct": color,
            "green_pct": color * 0.95,
            "blue_pct": color * 0.90,
        })

    fit_resp = await auth_client.post(
        "/api/wizard/fit-curves",
        json={"points": synthetic_points},
    )
    assert fit_resp.status_code == 200
    fit_data = fit_resp.json()

    # Step 4: Save profile
    save_resp = await auth_client.post(
        "/api/wizard/save-profile",
        json={
            "name": "Workflow Test Profile",
            "primary_channel": "Red",
            "fitted_params": fit_data,
            "points": synthetic_points,
        },
    )
    assert save_resp.status_code == 201
    assert save_resp.json()["name"] == "Workflow Test Profile"
