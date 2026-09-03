"""Tests for backend service functions (no HTTP, pure logic)."""

import numpy as np
import pytest

from app.services.calibration import (
    extract_color_percentages,
    fit_calibration_curves,
    rational_color_model,
)
from app.services.film_analyzer import (
    FilmAnalyzer,
    build_roi_mask,
    compute_dose_histogram,
)
from app.services.image_utils import generate_dose_map_preview, generate_preview, load_image


# ---------------------------------------------------------------------------
# image_utils.load_image
# ---------------------------------------------------------------------------


class TestLoadImage:
    def test_returns_5_tuple(self, test_film_path):
        result = load_image(test_film_path)
        assert isinstance(result, tuple)
        assert len(result) == 5

    def test_image_array_is_ndarray(self, test_film_path):
        image_array, dpi, width, height, channels = load_image(test_film_path)
        assert isinstance(image_array, np.ndarray)
        assert image_array.ndim in (2, 3)

    def test_dimensions_consistent(self, test_film_path):
        image_array, dpi, width, height, channels = load_image(test_film_path)
        assert image_array.shape[0] == height
        assert image_array.shape[1] == width
        if image_array.ndim == 3:
            assert image_array.shape[2] == channels
        else:
            assert channels == 1

    def test_dpi_is_positive(self, test_film_path):
        _, dpi, _, _, _ = load_image(test_film_path)
        assert isinstance(dpi, float)
        assert dpi > 0


# ---------------------------------------------------------------------------
# image_utils.generate_preview
# ---------------------------------------------------------------------------


class TestGeneratePreview:
    def test_returns_jpeg_bytes(self, test_film_path):
        image_array, *_ = load_image(test_film_path)
        jpeg_bytes = generate_preview(image_array)
        assert isinstance(jpeg_bytes, bytes)
        assert len(jpeg_bytes) > 0
        # JPEG magic bytes
        assert jpeg_bytes[:2] == b"\xff\xd8"

    def test_respects_max_width(self, test_film_path):
        image_array, *_ = load_image(test_film_path)
        from PIL import Image
        import io

        preview_bytes = generate_preview(image_array, max_width=500)
        img = Image.open(io.BytesIO(preview_bytes))
        assert img.width <= 500

    def test_handles_grayscale(self):
        gray = np.random.randint(0, 255, (100, 100), dtype=np.uint8)
        jpeg_bytes = generate_preview(gray)
        assert isinstance(jpeg_bytes, bytes)
        assert jpeg_bytes[:2] == b"\xff\xd8"

    def test_handles_uint16(self):
        """16-bit input is stretched to 8-bit rather than raising."""
        arr = np.linspace(0, 65535, 100 * 100, dtype=np.uint16).reshape(100, 100)
        jpeg_bytes = generate_preview(arr)
        assert jpeg_bytes[:2] == b"\xff\xd8"

    def test_handles_uint16_rgb(self):
        arr = np.random.randint(0, 65535, (60, 80, 3), dtype=np.uint16)
        jpeg_bytes = generate_preview(arr)
        assert jpeg_bytes[:2] == b"\xff\xd8"

    def test_uint16_is_stretched_to_full_range(self):
        """A narrow 16-bit range should span 0-255 after conversion."""
        from app.services.image_utils import _to_uint8

        arr = np.array([[1000, 1100], [1200, 1300]], dtype=np.uint16)
        out = _to_uint8(arr)
        assert out.dtype == np.uint8
        assert out.min() == 0
        assert out.max() == 255

    def test_uint8_passes_through_unchanged(self):
        """The 8-bit path must stay byte-identical."""
        from app.services.image_utils import _to_uint8

        arr = np.random.randint(0, 255, (20, 20, 3), dtype=np.uint8)
        assert _to_uint8(arr) is arr

    def test_handles_constant_and_nan(self):
        from app.services.image_utils import _to_uint8

        const = np.full((10, 10), 500, dtype=np.uint16)
        assert _to_uint8(const).max() == 0  # hi == lo -> scale 0

        with_nan = np.full((10, 10), np.nan, dtype=np.float32)
        assert _to_uint8(with_nan).max() == 0  # no finite values


# ---------------------------------------------------------------------------
# image_utils.generate_dose_map_preview
# ---------------------------------------------------------------------------


class TestGenerateDoseMapPreview:
    def test_returns_png_bytes(self):
        dose_map = np.random.uniform(0, 10, (50, 50))
        png_bytes = generate_dose_map_preview(dose_map, cmap_min=0, cmap_max=10)
        assert isinstance(png_bytes, bytes)
        assert len(png_bytes) > 0
        # PNG magic bytes
        assert png_bytes[:4] == b"\x89PNG"


# ---------------------------------------------------------------------------
# calibration.extract_color_percentages
# ---------------------------------------------------------------------------


class TestExtractColorPercentages:
    def test_returns_three_keys(self):
        # Create a synthetic 100x100 RGB image
        image = np.full((100, 100, 3), 128, dtype=np.uint8)
        result = extract_color_percentages(image, x=10, y=10, w=20, h=20)
        assert set(result.keys()) == {"red_pct", "green_pct", "blue_pct"}

    def test_values_in_range(self):
        image = np.random.randint(0, 256, (100, 100, 3), dtype=np.uint8)
        result = extract_color_percentages(image, x=0, y=0, w=50, h=50)
        for key in ("red_pct", "green_pct", "blue_pct"):
            assert 0.0 <= result[key] <= 1.0

    def test_known_values(self):
        # All-white image -> each channel = 255/255 -> 1.0 (values are
        # 0-1 fractions to match rational_func_calibration's pixel/255 scale)
        image = np.full((50, 50, 3), 255, dtype=np.uint8)
        result = extract_color_percentages(image, x=0, y=0, w=50, h=50)
        for key in ("red_pct", "green_pct", "blue_pct"):
            assert result[key] == pytest.approx(1.0)

    def test_black_image(self):
        image = np.zeros((50, 50, 3), dtype=np.uint8)
        result = extract_color_percentages(image, x=0, y=0, w=50, h=50)
        for key in ("red_pct", "green_pct", "blue_pct"):
            assert result[key] == pytest.approx(0.0)

    def test_with_real_film(self, test_film_path):
        image_array, *_ = load_image(test_film_path)
        h, w = image_array.shape[:2]
        # Pick a small central ROI
        cx, cy = w // 2, h // 2
        roi_size = min(50, w // 4, h // 4)
        result = extract_color_percentages(
            image_array,
            x=cx - roi_size // 2,
            y=cy - roi_size // 2,
            w=roi_size,
            h=roi_size,
        )
        assert set(result.keys()) == {"red_pct", "green_pct", "blue_pct"}
        for v in result.values():
            assert 0.0 <= v <= 1.0


# ---------------------------------------------------------------------------
# calibration.rational_color_model
# ---------------------------------------------------------------------------


class TestRationalColorModel:
    def test_basic_computation(self):
        # model: a + b / (dose - c)
        # With a=0.5, b=1.0, c=-1.0, dose=1.0 => 0.5 + 1.0/(1.0 - (-1.0)) = 0.5 + 0.5 = 1.0
        result = rational_color_model(1.0, 0.5, 1.0, -1.0)
        assert result == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# calibration.fit_calibration_curves
# ---------------------------------------------------------------------------


class TestFitCalibrationCurves:
    @pytest.fixture
    def calibration_points(self):
        """Generate synthetic calibration points from a known rational model."""
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
        return points

    def test_returns_correct_channels(self, calibration_points):
        result = fit_calibration_curves(calibration_points)
        assert set(result.keys()) == {"Red", "Green", "Blue"}

    def test_each_channel_has_required_keys(self, calibration_points):
        result = fit_calibration_curves(calibration_points)
        for ch in ("Red", "Green", "Blue"):
            assert "a" in result[ch]
            assert "b" in result[ch]
            assert "c" in result[ch]
            assert "r_squared" in result[ch]

    def test_r_squared_close_to_one(self, calibration_points):
        """Synthetic data generated from the model should yield R^2 ~ 1."""
        result = fit_calibration_curves(calibration_points)
        for ch in ("Red", "Green", "Blue"):
            assert result[ch]["r_squared"] > 0.99

    def test_too_few_points_raises(self):
        points = [
            {"dose": 1.0, "red_pct": 50, "green_pct": 50, "blue_pct": 50},
            {"dose": 2.0, "red_pct": 40, "green_pct": 40, "blue_pct": 40},
        ]
        with pytest.raises(ValueError, match="At least 4"):
            fit_calibration_curves(points)

    def test_exactly_four_points(self):
        """Four points is the minimum; should not raise."""
        a_true, b_true, c_true = 20.0, -500.0, -5.0
        doses = [0.5, 2.0, 5.0, 10.0]
        points = []
        for d in doses:
            color = a_true + b_true / (d - c_true)
            points.append({
                "dose": d,
                "red_pct": color,
                "green_pct": color,
                "blue_pct": color,
            })
        result = fit_calibration_curves(points)
        assert len(result) == 3


# ---------------------------------------------------------------------------
# film_analyzer.build_roi_mask
# ---------------------------------------------------------------------------


class TestBuildRoiMask:
    def test_rectangle_mask_shape(self):
        mask = build_roi_mask(
            shape=(100, 100),
            roi_type="Rectangle",
            x=10, y=10, w=30, h=20,
        )
        assert mask.shape == (100, 100)
        assert mask.dtype == bool

    def test_rectangle_mask_coverage(self):
        mask = build_roi_mask(
            shape=(100, 100),
            roi_type="Rectangle",
            x=0, y=0, w=99, h=99,
        )
        # Should cover most of the image
        assert np.sum(mask) > 5000

    def test_circle_mask(self):
        mask = build_roi_mask(
            shape=(200, 200),
            roi_type="Circle",
            x=50, y=50, w=100, h=100,
        )
        assert mask.shape == (200, 200)
        assert mask.dtype == bool
        # Area of ellipse = pi * rx * ry = pi * 50 * 50 ~ 7854
        assert 7000 < np.sum(mask) < 8500

    def test_ring_mask_has_hole(self):
        mask_circle = build_roi_mask(
            shape=(200, 200),
            roi_type="Circle",
            x=50, y=50, w=100, h=100,
        )
        mask_ring = build_roi_mask(
            shape=(200, 200),
            roi_type="Ring",
            x=50, y=50, w=100, h=100,
            hole_ratio=50,
        )
        # The ring should have fewer pixels than the full circle
        assert np.sum(mask_ring) < np.sum(mask_circle)
        assert np.sum(mask_ring) > 0

    def test_rotated_rectangle(self):
        mask = build_roi_mask(
            shape=(100, 100),
            roi_type="Rectangle",
            x=20, y=20, w=40, h=40,
            rotation_deg=45,
        )
        assert mask.shape == (100, 100)
        assert np.sum(mask) > 0

    def test_threshold_filters_low_dose(self):
        dose_map = np.zeros((100, 100), dtype=float)
        dose_map[30:60, 30:60] = 5.0  # only this region has dose > threshold

        mask = build_roi_mask(
            shape=(100, 100),
            roi_type="Rectangle",
            x=0, y=0, w=99, h=99,
            threshold=1.0,
            dose_map=dose_map,
        )
        # Only the 30x30 high-dose region should pass the threshold
        assert np.sum(mask) < 1500

    def test_zero_size_roi_returns_empty(self):
        mask = build_roi_mask(
            shape=(100, 100),
            roi_type="Circle",
            x=50, y=50, w=0, h=0,
        )
        assert np.sum(mask) == 0

    def test_chamfer_zero_is_noop(self):
        plain = build_roi_mask(
            shape=(100, 100),
            roi_type="Rectangle",
            x=10, y=10, w=60, h=40,
        )
        chamfered = build_roi_mask(
            shape=(100, 100),
            roi_type="Rectangle",
            x=10, y=10, w=60, h=40,
            corner_cut_px=0,
        )
        assert np.array_equal(plain, chamfered)

    def test_chamfer_reduces_area(self):
        plain = build_roi_mask(
            shape=(100, 100),
            roi_type="Rectangle",
            x=10, y=10, w=60, h=40,
        )
        chamfered = build_roi_mask(
            shape=(100, 100),
            roi_type="Rectangle",
            x=10, y=10, w=60, h=40,
            corner_cut_px=10,
        )
        # Each corner loses a triangle of area cut^2 / 2 = 50 -> 200 total
        removed = np.sum(plain) - np.sum(chamfered)
        assert 160 < removed < 280

    def test_chamfer_excludes_corner_keeps_center(self):
        mask = build_roi_mask(
            shape=(100, 100),
            roi_type="Rectangle",
            x=10, y=10, w=60, h=40,
            corner_cut_px=10,
        )
        # Corner pixel is cut, center remains
        assert not mask[11, 11]
        assert mask[30, 40]

    def test_chamfer_with_rotation(self):
        plain = build_roi_mask(
            shape=(200, 200),
            roi_type="Rectangle",
            x=50, y=50, w=80, h=80,
            rotation_deg=45,
        )
        chamfered = build_roi_mask(
            shape=(200, 200),
            roi_type="Rectangle",
            x=50, y=50, w=80, h=80,
            rotation_deg=45,
            corner_cut_px=10,
        )
        removed = np.sum(plain) - np.sum(chamfered)
        # 4 corners * 10^2 / 2 = 200 expected, allow discretization slack
        assert 140 < removed < 280

    def test_chamfer_clamped(self):
        # Excessive cut clamps to min(hw, hh) = 20 instead of erasing the ROI
        huge = build_roi_mask(
            shape=(100, 100),
            roi_type="Rectangle",
            x=10, y=10, w=60, h=40,
            corner_cut_px=1000,
        )
        clamped = build_roi_mask(
            shape=(100, 100),
            roi_type="Rectangle",
            x=10, y=10, w=60, h=40,
            corner_cut_px=20,
        )
        assert np.sum(huge) > 0
        assert np.array_equal(huge, clamped)

    def test_chamfer_ignored_for_circle(self):
        plain = build_roi_mask(
            shape=(200, 200),
            roi_type="Circle",
            x=50, y=50, w=100, h=100,
        )
        chamfered = build_roi_mask(
            shape=(200, 200),
            roi_type="Circle",
            x=50, y=50, w=100, h=100,
            corner_cut_px=10,
        )
        assert np.array_equal(plain, chamfered)


# ---------------------------------------------------------------------------
# film_analyzer.FilmAnalyzer
# ---------------------------------------------------------------------------


class TestFilmAnalyzer:
    def test_calculate_dose_map_red_channel(self):
        analyzer = FilmAnalyzer()
        analyzer.image_array = np.full((50, 50, 3), 128, dtype=np.uint8)
        dose_map = analyzer.calculate_dose_map("Red", a=0.3, b=1.0, c=-1.0)
        assert dose_map.shape == (50, 50)
        assert not np.all(np.isnan(dose_map))

    def test_calculate_dose_map_no_image_raises(self):
        analyzer = FilmAnalyzer()
        with pytest.raises(ValueError, match="No image loaded"):
            analyzer.calculate_dose_map("Red", 0.3, 1.0, -1.0)

    def test_get_roi_stats_returns_dict(self):
        analyzer = FilmAnalyzer()
        analyzer.dose_map = np.random.uniform(1, 10, (100, 100))
        mask = np.ones((100, 100), dtype=bool)
        stats = analyzer.get_roi_stats(mask)
        assert stats is not None
        assert "max" in stats
        assert "min" in stats
        assert "mean" in stats
        assert "std" in stats
        assert "cv" in stats
        assert "dur" in stats
        assert "flatness" in stats

    def test_get_roi_stats_empty_mask_returns_none(self):
        analyzer = FilmAnalyzer()
        analyzer.dose_map = np.random.uniform(1, 10, (100, 100))
        mask = np.zeros((100, 100), dtype=bool)
        stats = analyzer.get_roi_stats(mask)
        assert stats is None

    def test_get_roi_stats_no_dose_map_returns_none(self):
        analyzer = FilmAnalyzer()
        mask = np.ones((100, 100), dtype=bool)
        stats = analyzer.get_roi_stats(mask)
        assert stats is None

    def test_load_image_from_file(self, test_film_path):
        analyzer = FilmAnalyzer()
        result = analyzer.load_image(test_film_path)
        assert isinstance(result, np.ndarray)
        assert analyzer.image_array is not None

    def test_get_roi_stats_no_trim_uses_all_pixels(self):
        analyzer = FilmAnalyzer()
        analyzer.dose_map = np.arange(100, dtype=float).reshape(10, 10)
        mask = np.ones((10, 10), dtype=bool)
        stats = analyzer.get_roi_stats(mask, trim_enabled=False)
        assert stats["max"] == 99.0
        assert stats["min"] == 0.0

    def test_get_roi_stats_trim_two_percent(self):
        analyzer = FilmAnalyzer()
        analyzer.dose_map = np.arange(100, dtype=float).reshape(10, 10)
        mask = np.ones((10, 10), dtype=bool)
        stats = analyzer.get_roi_stats(mask, trim_enabled=True, trim_percent=2)
        # 2% of 100 values removed from each tail
        assert stats["min"] == 2.0
        assert stats["max"] == 97.0

    def test_get_roi_stats_trim_zero_percent_equals_disabled(self):
        analyzer = FilmAnalyzer()
        analyzer.dose_map = np.arange(100, dtype=float).reshape(10, 10)
        mask = np.ones((10, 10), dtype=bool)
        on_zero = analyzer.get_roi_stats(mask, trim_enabled=True, trim_percent=0)
        off = analyzer.get_roi_stats(mask, trim_enabled=False)
        assert on_zero == off

    def test_get_roi_stats_trim_tiny_roi_no_crash(self):
        analyzer = FilmAnalyzer()
        analyzer.dose_map = np.full((10, 10), 5.0)
        mask = np.zeros((10, 10), dtype=bool)
        mask[0, 0] = mask[0, 1] = True
        stats = analyzer.get_roi_stats(mask, trim_enabled=True, trim_percent=49)
        # 49% of 2 values trims nothing (int truncation) — must not crash
        assert stats is None or isinstance(stats, dict)

    def test_get_roi_stats_extended_keys(self):
        analyzer = FilmAnalyzer()
        analyzer.dose_map = np.linspace(1, 10, 10000).reshape(100, 100)
        mask = np.ones((100, 100), dtype=bool)
        stats = analyzer.get_roi_stats(mask)
        for key in (
            "median", "p2", "p98", "homogeneity_index",
            "trimmed_count", "trim_low", "trim_high", "histogram",
        ):
            assert key in stats
        assert stats["p2"] <= stats["median"] <= stats["p98"]
        assert stats["homogeneity_index"] == pytest.approx(
            (stats["p98"] - stats["p2"]) / stats["median"]
        )
        assert stats["trimmed_count"] == 10000
        assert stats["trim_low"] is None
        assert stats["trim_high"] is None
        assert stats["histogram"]["total_count"] == 10000
        assert sum(stats["histogram"]["counts"]) == 10000

    def test_get_roi_stats_trim_cutoffs(self):
        analyzer = FilmAnalyzer()
        analyzer.dose_map = np.arange(100, dtype=float).reshape(10, 10)
        mask = np.ones((10, 10), dtype=bool)
        on = analyzer.get_roi_stats(mask, trim_enabled=True, trim_percent=2)
        off = analyzer.get_roi_stats(mask, trim_enabled=False)
        assert on["trim_low"] == on["min"] == 2.0
        assert on["trim_high"] == on["max"] == 97.0
        assert on["trimmed_count"] == 96
        assert off["trim_low"] is None
        assert off["trim_high"] is None
        # The histogram describes every masked pixel, trimmed or not
        assert on["histogram"] == off["histogram"]
        assert on["histogram"]["total_count"] == 100

    def test_get_roi_stats_single_pixel(self):
        analyzer = FilmAnalyzer()
        analyzer.dose_map = np.full((10, 10), 5.0)
        mask = np.zeros((10, 10), dtype=bool)
        mask[3, 3] = True
        stats = analyzer.get_roi_stats(mask)
        assert stats["median"] == 5.0
        assert stats["homogeneity_index"] == 0
        assert stats["trimmed_count"] == 1

    def test_get_roi_stats_ignores_non_finite_pixels(self):
        analyzer = FilmAnalyzer()
        dose = np.full((10, 10), 4.0)
        dose[0, 0] = np.nan
        dose[0, 1] = np.inf
        analyzer.dose_map = dose
        mask = np.ones((10, 10), dtype=bool)
        stats = analyzer.get_roi_stats(mask)
        assert stats["mean"] == 4.0
        assert stats["trimmed_count"] == 98
        assert stats["histogram"]["total_count"] == 98

    def test_get_roi_stats_can_skip_histogram(self):
        analyzer = FilmAnalyzer()
        analyzer.dose_map = np.random.uniform(1, 10, (20, 20))
        stats = analyzer.get_roi_stats(
            np.ones((20, 20), dtype=bool), histogram_bins=0
        )
        assert stats["histogram"] is None


# ---------------------------------------------------------------------------
# film_analyzer.compute_dose_histogram
# ---------------------------------------------------------------------------


class TestDoseHistogram:
    def test_counts_sum_to_input(self):
        values = np.random.default_rng(1).uniform(0, 5, 1000)
        hist = compute_dose_histogram(values)
        assert hist["bins"] == 64
        assert len(hist["counts"]) == 64
        assert sum(hist["counts"]) == 1000
        assert hist["total_count"] == 1000
        assert hist["value_min"] == pytest.approx(values.min())
        assert hist["value_max"] == pytest.approx(values.max())
        assert hist["bin_width"] == pytest.approx((values.max() - values.min()) / 64)

    def test_extremes_land_in_end_bins(self):
        hist = compute_dose_histogram(np.array([1.0, 2.0, 3.0]), bins=4)
        assert hist["counts"] == [1, 0, 1, 1]

    def test_constant_values_use_a_padded_window(self):
        hist = compute_dose_histogram(np.full(50, 2.5))
        assert hist["bin_width"] > 0
        assert hist["value_min"] < 2.5 < hist["value_max"]
        assert hist["counts"][32] == 50
        assert sum(hist["counts"]) == 50

    def test_ignores_non_finite(self):
        values = np.array([1.0, np.nan, 2.0, np.inf, 3.0, -np.inf])
        hist = compute_dose_histogram(values, bins=8)
        assert hist["total_count"] == 3
        assert sum(hist["counts"]) == 3

    def test_empty_input(self):
        hist = compute_dose_histogram(np.array([]), bins=16)
        assert hist["counts"] == [0] * 16
        assert hist["total_count"] == 0
        assert hist["bin_width"] == 0.0

    def test_rejects_zero_bins(self):
        with pytest.raises(ValueError):
            compute_dose_histogram(np.array([1.0]), bins=0)
