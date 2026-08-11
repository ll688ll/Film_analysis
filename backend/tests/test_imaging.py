"""Tests for the general image-analysis endpoints (/api/imaging)."""

import io
import struct

import numpy as np
import pytest
from httpx import AsyncClient
from PIL import Image

pytestmark = pytest.mark.asyncio


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _png_bytes(img: Image.Image) -> io.BytesIO:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf


def _quadrant_image() -> Image.Image:
    """100x100 grayscale, four equal quadrants at 32 / 96 / 160 / 224."""
    arr = np.zeros((100, 100), np.uint8)
    arr[:50, :50] = 32
    arr[:50, 50:] = 96
    arr[50:, :50] = 160
    arr[50:, 50:] = 224
    return Image.fromarray(arr, mode="L")


async def _upload(auth_client: AsyncClient, img: Image.Image, name="t.png") -> dict:
    resp = await auth_client.post(
        "/api/imaging/upload", files={"file": (name, _png_bytes(img), "image/png")}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _upload_quadrants(auth_client: AsyncClient) -> str:
    return (await _upload(auth_client, _quadrant_image()))["session_id"]


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------


async def test_upload_returns_metadata(auth_client: AsyncClient):
    data = await _upload(auth_client, Image.new("RGB", (40, 30), (10, 20, 30)))
    assert data["width"] == 40
    assert data["height"] == 30
    assert data["channels"] == 3
    assert data["dtype"] == "uint8"
    assert data["max_possible"] == 255
    assert data["has_alpha"] is False
    assert data["n_frames"] == 1


async def test_upload_reports_missing_dpi(auth_client: AsyncClient):
    """A general image has no physical scale; the UI must not fabricate mm."""
    data = await _upload(auth_client, Image.new("RGB", (10, 10)))
    assert data["has_dpi"] is False


async def test_upload_accepts_bmp(auth_client: AsyncClient):
    buf = io.BytesIO()
    Image.new("RGB", (12, 12), (5, 5, 5)).save(buf, format="BMP")
    buf.seek(0)
    resp = await auth_client.post(
        "/api/imaging/upload", files={"file": ("x.bmp", buf, "image/bmp")}
    )
    assert resp.status_code == 200, resp.text


async def test_upload_accepts_gif_and_decodes_palette(auth_client: AsyncClient):
    """GIF is palette-based; the loader must return colour, not indices."""
    rgb = Image.new("RGB", (16, 16), (240, 30, 30))
    buf = io.BytesIO()
    rgb.convert("P", palette=Image.ADAPTIVE).save(buf, format="GIF")
    buf.seek(0)
    resp = await auth_client.post(
        "/api/imaging/upload", files={"file": ("x.gif", buf, "image/gif")}
    )
    assert resp.status_code == 200, resp.text
    session_id = resp.json()["session_id"]

    resp = await auth_client.post(
        f"/api/imaging/{session_id}/analyze", json={"source": "Red"}
    )
    assert resp.status_code == 200
    # Palette index would be 0; the real red channel is ~240
    assert resp.json()["overall"]["mean"] > 200


async def test_upload_rejects_unknown_extension(auth_client: AsyncClient):
    resp = await auth_client.post(
        "/api/imaging/upload",
        files={"file": ("bad.xyz", io.BytesIO(b"junk"), "application/octet-stream")},
    )
    assert resp.status_code == 400
    assert "Unsupported file type" in resp.json()["detail"]


async def test_upload_rejects_corrupt_image(auth_client: AsyncClient):
    resp = await auth_client.post(
        "/api/imaging/upload",
        files={"file": ("bad.png", io.BytesIO(b"not a png"), "image/png")},
    )
    assert resp.status_code == 400


async def test_upload_requires_auth(client: AsyncClient):
    resp = await client.post(
        "/api/imaging/upload",
        files={"file": ("t.png", _png_bytes(Image.new("RGB", (4, 4))), "image/png")},
    )
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Analyze
# ---------------------------------------------------------------------------


async def test_analyze_requires_auth(client: AsyncClient):
    resp = await client.post("/api/imaging/abc/analyze", json={})
    assert resp.status_code == 401


async def test_analyze_missing_session(auth_client: AsyncClient):
    resp = await auth_client.post("/api/imaging/nope/analyze", json={})
    assert resp.status_code == 404


async def test_analyze_does_not_require_calibration(auth_client: AsyncClient):
    """The whole point of this page: no profile, no dose model, just pixels."""
    session_id = await _upload_quadrants(auth_client)
    resp = await auth_client.post(f"/api/imaging/{session_id}/analyze", json={})
    assert resp.status_code == 200
    assert resp.json()["total_count"] == 10000


async def test_analyze_counts_and_bins(auth_client: AsyncClient):
    session_id = await _upload_quadrants(auth_client)
    resp = await auth_client.post(
        f"/api/imaging/{session_id}/analyze", json={"bins": 256}
    )
    data = resp.json()
    assert len(data["counts"]) == 256
    assert len(data["sums"]) == 256
    assert len(data["sumsqs"]) == 256
    assert sum(data["counts"]) == data["total_count"] == 10000


async def test_analyze_with_roi_reduces_count(auth_client: AsyncClient):
    """An ROI wholly inside the 32-valued quadrant sees only that value.

    ``build_roi_mask`` is inclusive on both edges, so a w=30 box spans 31
    pixels -- the ROI is kept clear of the quadrant boundary so the count is
    unambiguous.
    """
    session_id = await _upload_quadrants(auth_client)
    resp = await auth_client.post(
        f"/api/imaging/{session_id}/analyze",
        json={"roi": {"roi_type": "Rectangle", "x": 5, "y": 5, "w": 30, "h": 30}},
    )
    data = resp.json()
    assert data["total_count"] == 31 * 31
    assert data["overall"]["mean"] == pytest.approx(32.0)
    assert data["overall"]["std"] == pytest.approx(0.0)


async def test_analyze_invalid_bins(auth_client: AsyncClient):
    session_id = await _upload_quadrants(auth_client)
    resp = await auth_client.post(
        f"/api/imaging/{session_id}/analyze", json={"bins": 4}
    )
    assert resp.status_code == 422


async def test_analyze_rgb_source_on_grayscale_is_400(auth_client: AsyncClient):
    session_id = await _upload_quadrants(auth_client)
    resp = await auth_client.post(
        f"/api/imaging/{session_id}/analyze", json={"source": "Red"}
    )
    assert resp.status_code == 400
    assert "grayscale" in resp.json()["detail"]


async def test_analyze_ignore_transparent(auth_client: AsyncClient):
    img = Image.new("RGBA", (10, 10), (200, 200, 200, 255))
    for x in range(10):
        for y in range(5):
            img.putpixel((x, y), (200, 200, 200, 0))
    session_id = (await _upload(auth_client, img))["session_id"]

    opaque = await auth_client.post(
        f"/api/imaging/{session_id}/analyze", json={"ignore_transparent": False}
    )
    assert opaque.json()["total_count"] == 100

    filtered = await auth_client.post(
        f"/api/imaging/{session_id}/analyze", json={"ignore_transparent": True}
    )
    assert filtered.json()["total_count"] == 50


async def test_analyze_reports_dpi_from_tiff(auth_client: AsyncClient, test_film_path: str):
    with open(test_film_path, "rb") as f:
        resp = await auth_client.post(
            "/api/imaging/upload", files={"file": ("CAL_007.tif", f, "image/tiff")}
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["has_dpi"] is True
    assert data["channels"] == 3


# ---------------------------------------------------------------------------
# Plane
# ---------------------------------------------------------------------------


async def test_plane_length_and_headers(auth_client: AsyncClient):
    session_id = await _upload_quadrants(auth_client)
    resp = await auth_client.get(f"/api/imaging/{session_id}/plane?bins=256")
    assert resp.status_code == 200

    w = int(resp.headers["x-width"])
    h = int(resp.headers["x-height"])
    assert (w, h) == (100, 100)
    assert len(resp.content) == w * h * 2  # uint16
    assert resp.headers["x-int-bins"] == "256"
    assert resp.headers["x-int-nodata"] == "256"
    assert resp.headers["x-int-format"] == "u16-bins"
    assert resp.headers["x-int-downsample"] == "1"

    exposed = resp.headers["access-control-expose-headers"]
    for name in ("X-Int-Bins", "X-Int-Min", "X-Int-Max", "X-Int-Downsample"):
        assert name in exposed


async def test_plane_codes_match_histogram(auth_client: AsyncClient):
    """
    The painted map and the level table must index identical bins.

    This is the invariant that makes client-side level colouring trustworthy.
    """
    session_id = await _upload_quadrants(auth_client)

    hist = (await auth_client.post(
        f"/api/imaging/{session_id}/analyze", json={"bins": 64}
    )).json()
    resp = await auth_client.get(f"/api/imaging/{session_id}/plane?bins=64")

    codes = np.frombuffer(resp.content, dtype=np.uint16)
    code_counts = np.bincount(codes, minlength=65)[:64]
    np.testing.assert_array_equal(code_counts, np.array(hist["counts"]))


async def test_plane_downsampled(auth_client: AsyncClient):
    session_id = await _upload_quadrants(auth_client)
    resp = await auth_client.get(f"/api/imaging/{session_id}/plane?max_dim=64")
    assert resp.status_code == 200
    assert int(resp.headers["x-int-downsample"]) == 2
    w = int(resp.headers["x-width"])
    h = int(resp.headers["x-height"])
    assert max(w, h) <= 64
    assert len(resp.content) == w * h * 2


async def test_plane_rejects_tiny_max_dim(auth_client: AsyncClient):
    session_id = await _upload_quadrants(auth_client)
    resp = await auth_client.get(f"/api/imaging/{session_id}/plane?max_dim=8")
    assert resp.status_code == 422


async def test_plane_missing_session(auth_client: AsyncClient):
    resp = await auth_client.get("/api/imaging/nope/plane")
    assert resp.status_code == 404


async def test_plane_marks_out_of_window_as_nodata(auth_client: AsyncClient):
    session_id = await _upload_quadrants(auth_client)
    resp = await auth_client.get(
        f"/api/imaging/{session_id}/plane?bins=64&value_min=100&value_max=255"
    )
    codes = np.frombuffer(resp.content, dtype=np.uint16)
    # The 32 and 96 quadrants (5000 px) fall below the window
    assert int((codes == 64).sum()) == 5000


# ---------------------------------------------------------------------------
# Thresholds
# ---------------------------------------------------------------------------


async def test_thresholds_otsu(auth_client: AsyncClient):
    session_id = await _upload_quadrants(auth_client)
    resp = await auth_client.post(
        f"/api/imaging/{session_id}/thresholds",
        json={"bins": 256, "levels": 4, "method": "otsu"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["edges"]) == 5
    assert data["edges"] == sorted(data["edges"])
    assert len(data["edge_bins"]) == 3


async def test_thresholds_equal_width(auth_client: AsyncClient):
    session_id = await _upload_quadrants(auth_client)
    resp = await auth_client.post(
        f"/api/imaging/{session_id}/thresholds",
        json={"bins": 256, "levels": 4, "method": "equal_width",
              "value_min": 0, "value_max": 256},
    )
    data = resp.json()
    assert data["edge_bins"] == [64, 128, 192]
    assert data["edges"] == [0, 64, 128, 192, 256]


async def test_thresholds_separate_the_quadrants(auth_client: AsyncClient):
    """Otsu on four flat levels should isolate each quadrant."""
    session_id = await _upload_quadrants(auth_client)
    thresh = (await auth_client.post(
        f"/api/imaging/{session_id}/thresholds",
        json={"bins": 256, "levels": 4, "method": "otsu"},
    )).json()

    stats = (await auth_client.post(
        f"/api/imaging/{session_id}/level-stats", json={"edges": thresh["edges"]}
    )).json()
    assert [s["count"] for s in stats["levels"]] == [2500] * 4
    assert [s["mean"] for s in stats["levels"]] == [32, 96, 160, 224]


async def test_thresholds_rejects_too_many_levels(auth_client: AsyncClient):
    session_id = await _upload_quadrants(auth_client)
    resp = await auth_client.post(
        f"/api/imaging/{session_id}/thresholds", json={"levels": 99}
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Level stats
# ---------------------------------------------------------------------------


async def test_level_stats_counts_sum_to_total(auth_client: AsyncClient):
    session_id = await _upload_quadrants(auth_client)
    resp = await auth_client.post(
        f"/api/imaging/{session_id}/level-stats",
        json={"edges": [0, 64, 128, 192, 256]},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_count"] == 10000
    assert sum(s["count"] for s in data["levels"]) == 10000
    assert sum(s["count_pct"] for s in data["levels"]) == pytest.approx(100.0)


async def test_level_stats_rejects_unsorted_edges(auth_client: AsyncClient):
    session_id = await _upload_quadrants(auth_client)
    resp = await auth_client.post(
        f"/api/imaging/{session_id}/level-stats", json={"edges": [0, 200, 100]}
    )
    assert resp.status_code == 400


async def test_level_stats_matches_client_derivation(auth_client: AsyncClient):
    """
    End-to-end check of the architecture: what the browser computes from the
    histogram must equal what the server computes from the raw pixels.
    """
    rng = np.random.default_rng(42)
    arr = rng.integers(0, 256, (80, 80)).astype(np.uint8)
    session_id = (await _upload(auth_client, Image.fromarray(arr, mode="L")))["session_id"]

    hist = (await auth_client.post(
        f"/api/imaging/{session_id}/analyze", json={"bins": 256}
    )).json()

    bounds = [0, 64, 128, 192, 256]
    edges = [hist["value_min"] + b * hist["bin_width"] for b in bounds]
    exact = (await auth_client.post(
        f"/api/imaging/{session_id}/level-stats", json={"edges": edges}
    )).json()["levels"]

    c0 = np.concatenate(([0.0], np.cumsum(hist["counts"])))
    c1 = np.concatenate(([0.0], np.cumsum(hist["sums"])))
    for i, stat in enumerate(exact):
        lo, hi = bounds[i], bounds[i + 1]
        n = c0[hi] - c0[lo]
        assert int(n) == stat["count"], f"level {i}"
        if n:
            assert (c1[hi] - c1[lo]) / n == pytest.approx(stat["mean"], rel=1e-9)


# ---------------------------------------------------------------------------
# Isolation
# ---------------------------------------------------------------------------


async def test_cross_user_session_is_404(auth_client: AsyncClient, client: AsyncClient):
    session_id = await _upload_quadrants(auth_client)

    resp = await client.post(
        "/api/auth/register",
        json={"username": "other2", "email": "other2@example.com", "password": "pw123456"},
    )
    assert resp.status_code == 201
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    resp = await client.post(
        f"/api/imaging/{session_id}/analyze", json={}, headers=headers
    )
    assert resp.status_code == 404

    resp = await client.get(f"/api/imaging/{session_id}/plane", headers=headers)
    assert resp.status_code == 404
