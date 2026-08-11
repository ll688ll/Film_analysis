"""Tests for robust general-image loading (app.services.image_io)."""

import numpy as np
import pytest
from PIL import Image

from app.services.image_io import load_image_general


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _save(tmp_path, img, name, **kwargs):
    path = tmp_path / name
    img.save(path, **kwargs)
    return str(path)


# ---------------------------------------------------------------------------
# Mode normalisation
# ---------------------------------------------------------------------------


class TestModeNormalisation:
    def test_palette_png_is_converted_not_indexed(self, tmp_path):
        """
        A mode-P image must come back as real colour.

        Without conversion np.array() returns palette *indices*, which would
        silently produce meaningless intensity statistics.
        """
        rgb = Image.new("RGB", (8, 8))
        # Two distinct, far-apart colours so indices and values cannot coincide
        for x in range(8):
            for y in range(8):
                rgb.putpixel((x, y), (250, 10, 10) if x < 4 else (10, 10, 250))
        pal = rgb.convert("P", palette=Image.ADAPTIVE, colors=2)
        path = _save(tmp_path, pal, "pal.png")

        # Sanity: the raw PIL array really is indices (0/1), not colour
        raw = np.array(Image.open(path))
        assert raw.ndim == 2
        assert set(np.unique(raw).tolist()) <= {0, 1}

        loaded = load_image_general(path)
        assert loaded.original_mode == "P"
        assert loaded.mode == "RGB"
        assert loaded.array.ndim == 3
        assert loaded.array.max() > 200  # real colour values, not indices

    def test_palette_gif_is_converted(self, tmp_path):
        rgb = Image.new("RGB", (6, 6), (200, 100, 50))
        path = _save(tmp_path, rgb.convert("P", palette=Image.ADAPTIVE), "pal.gif")

        loaded = load_image_general(path)
        assert loaded.original_mode == "P"
        assert loaded.mode in ("RGB", "RGBA")
        assert loaded.channels >= 3

    def test_palette_with_transparency_keeps_alpha(self, tmp_path):
        rgb = Image.new("RGB", (6, 6), (200, 100, 50))
        pal = rgb.convert("P", palette=Image.ADAPTIVE)
        path = _save(tmp_path, pal, "pal_t.png", transparency=0)

        loaded = load_image_general(path)
        assert loaded.mode == "RGBA"
        assert loaded.alpha is not None

    def test_bilevel_becomes_grayscale(self, tmp_path):
        arr = np.zeros((10, 10), dtype=bool)
        arr[:5] = True
        path = _save(tmp_path, Image.fromarray(arr), "bw.png")

        loaded = load_image_general(path)
        assert loaded.original_mode == "1"
        assert loaded.mode == "L"
        assert loaded.array.dtype == np.uint8
        assert set(np.unique(loaded.array).tolist()) == {0, 255}

    def test_cmyk_becomes_rgb(self, tmp_path):
        path = _save(tmp_path, Image.new("CMYK", (8, 8), (10, 20, 30, 40)), "c.tif")

        loaded = load_image_general(path)
        assert loaded.original_mode == "CMYK"
        assert loaded.mode == "RGB"
        assert loaded.channels == 3

    def test_rgba_png_exposes_alpha_plane(self, tmp_path):
        img = Image.new("RGBA", (8, 8), (10, 20, 30, 255))
        for x in range(4):
            for y in range(8):
                img.putpixel((x, y), (10, 20, 30, 0))
        path = _save(tmp_path, img, "a.png")

        loaded = load_image_general(path)
        assert loaded.mode == "RGBA"
        assert loaded.channels == 4
        assert loaded.alpha is not None
        assert loaded.alpha.shape == (8, 8)
        assert int((loaded.alpha == 0).sum()) == 32

    def test_opaque_rgb_has_no_alpha(self, tmp_path):
        path = _save(tmp_path, Image.new("RGB", (5, 5), (1, 2, 3)), "o.png")
        assert load_image_general(path).alpha is None

    def test_grayscale_stays_2d(self, tmp_path):
        arr = np.random.randint(0, 255, (12, 9), dtype=np.uint8)
        path = _save(tmp_path, Image.fromarray(arr, mode="L"), "g.png")

        loaded = load_image_general(path)
        assert loaded.array.ndim == 2
        assert loaded.channels == 1
        assert loaded.width == 9 and loaded.height == 12

    def test_uint16_keeps_full_range(self, tmp_path):
        arr = np.linspace(0, 65535, 64, dtype=np.uint16).reshape(8, 8)
        path = _save(tmp_path, Image.fromarray(arr), "16.tif")

        loaded = load_image_general(path)
        assert loaded.array.dtype in (np.uint16, np.int32)
        assert int(loaded.array.max()) > 60000


# ---------------------------------------------------------------------------
# EXIF orientation
# ---------------------------------------------------------------------------


class TestExifOrientation:
    def test_orientation_tag_is_applied(self, tmp_path):
        """Orientation 6 means 'rotate 90 CW', so W x H must swap."""
        img = Image.new("RGB", (20, 10), (128, 128, 128))
        exif = img.getexif()
        exif[274] = 6  # 274 == Orientation
        path = tmp_path / "rot.jpg"
        img.save(path, exif=exif)

        loaded = load_image_general(str(path))
        assert (loaded.width, loaded.height) == (10, 20)

    def test_no_exif_is_unchanged(self, tmp_path):
        path = _save(tmp_path, Image.new("RGB", (20, 10)), "plain.jpg")
        loaded = load_image_general(path)
        assert (loaded.width, loaded.height) == (20, 10)


# ---------------------------------------------------------------------------
# Multi-frame
# ---------------------------------------------------------------------------


class TestMultiFrame:
    def test_animated_gif_uses_frame_zero(self, tmp_path):
        frames = [
            Image.new("RGB", (8, 8), (0, 0, 0)),
            Image.new("RGB", (8, 8), (255, 255, 255)),
            Image.new("RGB", (8, 8), (128, 128, 128)),
        ]
        path = tmp_path / "anim.gif"
        frames[0].save(path, save_all=True, append_images=frames[1:])

        loaded = load_image_general(str(path))
        assert loaded.n_frames == 3
        assert int(loaded.array.max()) < 40  # the black first frame

    def test_single_frame_reports_one(self, tmp_path):
        path = _save(tmp_path, Image.new("RGB", (5, 5)), "s.png")
        assert load_image_general(path).n_frames == 1


# ---------------------------------------------------------------------------
# DPI
# ---------------------------------------------------------------------------


class TestDpi:
    def test_dpi_present(self, tmp_path):
        path = tmp_path / "dpi.tif"
        Image.new("RGB", (10, 10)).save(path, dpi=(300, 300))

        loaded = load_image_general(str(path))
        assert loaded.has_dpi is True
        assert loaded.dpi == pytest.approx(300.0)

    def test_dpi_absent_flags_false(self, tmp_path):
        path = _save(tmp_path, Image.new("RGB", (10, 10)), "nodpi.png")

        loaded = load_image_general(path)
        assert loaded.has_dpi is False
        assert loaded.dpi == 72.0

    def test_plain_jpeg_reports_no_dpi(self, tmp_path):
        path = _save(tmp_path, Image.new("RGB", (20, 10)), "plain.jpg")
        assert load_image_general(path).has_dpi is False

    def test_exif_jpeg_synthesized_72dpi_is_not_trusted(self, tmp_path):
        """
        Once a JPEG carries EXIF, Pillow reports dpi=(72,72) even though the
        JFIF unit is 0 -- meaning the density pair is an aspect ratio, not a
        resolution. Trusting it would put fabricated mm figures in the level
        table, so has_dpi must stay False.
        """
        img = Image.new("RGB", (20, 10))
        exif = img.getexif()
        exif[274] = 1  # Orientation, enough to make Pillow write an EXIF block
        path = tmp_path / "exif.jpg"
        img.save(path, exif=exif)

        info = Image.open(path).info
        assert info.get("dpi") == (72, 72)  # the synthesized value
        assert info.get("jfif_unit") == 0  # ...with no real unit behind it

        assert load_image_general(str(path)).has_dpi is False

    def test_jpeg_with_real_dpi_is_kept(self, tmp_path):
        path = tmp_path / "real.jpg"
        Image.new("RGB", (20, 10)).save(path, dpi=(300, 300))

        loaded = load_image_general(str(path))
        assert loaded.has_dpi is True
        assert loaded.dpi == pytest.approx(300.0, abs=1.0)

    def test_tiff_without_resolution_tag_reports_no_dpi(self, tmp_path):
        """
        Pillow synthesizes dpi=(1, 1) for a TIFF carrying no XResolution tag.
        Taken at face value that is 25.4 mm per pixel -- an invented scale.
        """
        path = tmp_path / "nores.tif"
        Image.fromarray(np.zeros((8, 8), np.uint16)).save(path)
        assert Image.open(path).info.get("dpi") == (1, 1)  # Pillow's fallback

        loaded = load_image_general(str(path))
        assert loaded.has_dpi is False

    def test_tiff_with_resolution_unit_none_reports_no_dpi(self, tmp_path):
        """ResolutionUnit 1 means the values are an aspect ratio, not a scale."""
        path = tmp_path / "unitnone.tif"
        Image.new("L", (8, 8)).save(
            path, tiffinfo={282: 100.0, 283: 100.0, 296: 1}
        )
        assert load_image_general(str(path)).has_dpi is False

    def test_tiff_with_absent_unit_defaults_to_inches(self, tmp_path):
        """
        An absent ResolutionUnit is not the same as unit "none" -- the TIFF
        default is inches, and real scanner output relies on it (the project's
        own CAL_007.tif has XResolution 254 and no unit tag).
        """
        path = tmp_path / "nounit.tif"
        Image.new("L", (8, 8)).save(path, tiffinfo={282: 254.0, 283: 254.0})

        loaded = load_image_general(str(path))
        assert loaded.has_dpi is True
        assert loaded.dpi == pytest.approx(254.0)

    def test_zero_dpi_treated_as_absent(self, tmp_path):
        path = tmp_path / "zero.tif"
        Image.new("RGB", (10, 10)).save(path, dpi=(0, 0))

        loaded = load_image_general(str(path))
        assert loaded.has_dpi is False
        assert loaded.dpi == 72.0

    def test_real_film_scan_has_dpi(self, test_film_path):
        loaded = load_image_general(test_film_path)
        assert loaded.has_dpi is True
        assert loaded.dpi > 0
        assert loaded.channels == 3


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class TestErrors:
    def test_non_image_raises_value_error(self, tmp_path):
        path = tmp_path / "junk.png"
        path.write_bytes(b"definitely not an image")

        with pytest.raises(ValueError):
            load_image_general(str(path))

    def test_missing_file_raises_value_error(self, tmp_path):
        with pytest.raises(ValueError):
            load_image_general(str(tmp_path / "absent.png"))
