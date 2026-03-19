"""Film analysis computation logic extracted from the desktop application."""

import numpy as np
from PIL import Image


def rational_func_calibration(pixel_val, a, b, c):
    """
    Calculates dose from pixel value using the rational function:
    Dose = b / (color_percentage - a) + c
    where color_percentage = pixel_val / 255.0
    """
    color_percentage = pixel_val.astype(float) / 255.0
    denominator = color_percentage - a
    term1 = np.divide(
        b, denominator,
        out=np.zeros_like(denominator),
        where=denominator != 0,
    )
    return term1 + c


def build_roi_mask(shape, roi_type, x, y, w, h,
                   rotation_deg=0, hole_ratio=50, threshold=0,
                   dose_map=None):
    """
    Build a boolean ROI mask over a 2-D grid of the given *shape* (rows, cols).

    Parameters
    ----------
    shape : tuple[int, int]
        (rows, cols) of the target grid.
    roi_type : str
        One of "Rectangle", "Circle", or "Ring".
    x, y : float
        Top-left corner of the bounding box.
    w, h : float
        Width and height of the bounding box.
    rotation_deg : float
        Rotation angle in degrees (used for Rectangle ROIs).
    hole_ratio : float
        Inner hole percentage for Ring ROIs (0-100).
    threshold : float
        If > 0, pixels with dose <= threshold are excluded.
    dose_map : np.ndarray or None
        Required when *threshold* > 0.

    Returns
    -------
    np.ndarray
        Boolean mask with shape (*shape*).
    """
    rows, cols = shape
    Y, X = np.ogrid[:rows, :cols]

    if roi_type == "Rectangle":
        if rotation_deg == 0:
            mask = (X >= x) & (X <= x + w) & (Y >= y) & (Y <= y + h)
        else:
            cx, cy = x + w / 2, y + h / 2
            hw, hh = w / 2, h / 2
            rad = -np.radians(rotation_deg)
            cos_a, sin_a = np.cos(rad), np.sin(rad)
            dX = X - cx
            dY = Y - cy
            rotX = dX * cos_a - dY * sin_a
            rotY = dX * sin_a + dY * cos_a
            mask = (rotX >= -hw) & (rotX <= hw) & (rotY >= -hh) & (rotY <= hh)
    else:
        cx, cy = x + w / 2, y + h / 2
        rx, ry = w / 2, h / 2
        if rx == 0 or ry == 0:
            return np.zeros((rows, cols), dtype=bool)
        dist_sq = (X - cx) ** 2 / rx ** 2 + (Y - cy) ** 2 / ry ** 2
        if roi_type == "Circle":
            mask = dist_sq <= 1
        else:  # Ring
            ratio = hole_ratio / 100.0
            mask = (dist_sq <= 1) & (dist_sq >= ratio ** 2)

    if threshold > 0 and dose_map is not None:
        mask = mask & (dose_map > threshold)

    return mask


class FilmAnalyzer:
    """Stateful film analysis engine."""

    def __init__(self):
        self.image_array = None
        self.dose_map = None
        self.dpi = 72.0

    def load_image(self, filepath):
        """Load an image file and store the pixel array."""
        img = Image.open(filepath)
        self.image_array = np.array(img)
        if "dpi" in img.info:
            self.dpi = img.info["dpi"][0]
        return self.image_array

    def calculate_dose_map(self, channel, a, b, c):
        """
        Compute a dose map from the loaded image using the rational
        calibration function with parameters *a*, *b*, *c*.

        Parameters
        ----------
        channel : str
            "Red", "Green", "Blue", or any other value for the mean of
            all channels.
        a, b, c : float
            Rational-function calibration coefficients.

        Returns
        -------
        np.ndarray
            2-D dose map.
        """
        if self.image_array is None:
            raise ValueError("No image loaded")

        if self.image_array.ndim == 2:
            arr = self.image_array.astype(float)
        else:
            channel_index = {"Red": 0, "Green": 1, "Blue": 2}
            if channel in channel_index:
                arr = self.image_array[:, :, channel_index[channel]].astype(float)
            else:
                arr = np.mean(self.image_array, axis=2).astype(float)

        self.dose_map = rational_func_calibration(arr, a, b, c)
        return self.dose_map

    def get_roi_stats(self, roi_mask):
        """
        Compute descriptive statistics for the dose map within the
        given boolean *roi_mask*.

        The outer 1 % on each tail is trimmed before computing stats.

        Returns
        -------
        dict or None
            Keys: max, min, mean, std, cv, dur, flatness.
        """
        if self.dose_map is None:
            return None

        masked_dose = self.dose_map[roi_mask]
        if masked_dose.size == 0:
            return None

        sorted_dose = np.sort(masked_dose.flatten())
        lo = int(len(sorted_dose) * 0.01)
        hi = int(len(sorted_dose) * 0.99)
        trimmed = sorted_dose[lo:hi]

        if trimmed.size == 0:
            return None

        trimmed_max = float(np.max(trimmed))
        trimmed_min = float(np.min(trimmed))
        mean_dose = float(np.mean(trimmed))
        std_dose = float(np.std(trimmed))
        cv_dose = std_dose / mean_dose * 100 if mean_dose != 0 else float("inf")

        if trimmed_min != 0:
            dur = trimmed_max / trimmed_min
            flatness = (
                (trimmed_max - trimmed_min)
                / (trimmed_max + trimmed_min)
                * 100
            )
        else:
            dur = float("inf")
            flatness = float("inf")

        return {
            "max": trimmed_max,
            "min": trimmed_min,
            "mean": mean_dose,
            "std": std_dose,
            "cv": cv_dose,
            "dur": dur,
            "flatness": flatness,
        }
