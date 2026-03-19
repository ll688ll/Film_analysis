"""Calibration curve fitting for radiochromic film dosimetry."""

import numpy as np
from scipy.optimize import curve_fit


def rational_color_model(dose, a, b, c):
    """Forward model: Color% = a + b / (Dose - c)."""
    return a + b / (dose - c)


def extract_color_percentages(image_array, x, y, w, h):
    """
    Extract mean RGB colour percentages from a rectangular ROI.

    Parameters
    ----------
    image_array : np.ndarray
        Full image as an (H, W, C) array (C >= 3).
    x, y : int
        Top-left corner of the ROI.
    w, h : int
        Width and height of the ROI.

    Returns
    -------
    dict
        Keys: red_pct, green_pct, blue_pct (each 0-1).
    """
    roi = image_array[y : y + h, x : x + w]
    means = roi.mean(axis=(0, 1))  # per-channel mean (0-255)
    # Return 0-1 range to match desktop app and rational_func_calibration
    return {
        "red_pct": float(means[0] / 255.0),
        "green_pct": float(means[1] / 255.0),
        "blue_pct": float(means[2] / 255.0),
    }


def fit_calibration_curves(calibration_points):
    """
    Fit rational colour-model curves to calibration data.

    Parameters
    ----------
    calibration_points : list[dict]
        Each dict must contain: dose, red_pct, green_pct, blue_pct.
        A minimum of 4 points is required.

    Returns
    -------
    dict
        Per-channel results keyed by "red", "green", "blue".
        Each value is a dict with:
          - params: (a, b, c) fitted coefficients
          - r_squared: coefficient of determination

    Raises
    ------
    ValueError
        If fewer than 4 calibration points are provided.
    RuntimeError
        If curve fitting fails for any channel.
    """
    if len(calibration_points) < 4:
        raise ValueError(
            f"At least 4 calibration points are required, got {len(calibration_points)}"
        )

    doses = np.array([p["dose"] for p in calibration_points], dtype=float)

    channel_data = {
        "Red": np.array([p["red_pct"] for p in calibration_points], dtype=float),
        "Green": np.array([p["green_pct"] for p in calibration_points], dtype=float),
        "Blue": np.array([p["blue_pct"] for p in calibration_points], dtype=float),
    }

    results = {}

    for ch_name, colors in channel_data.items():
        # Initial guesses
        a0 = float(np.min(colors))
        c0 = -1.0
        b0 = (float(np.max(colors)) - a0) * (-c0)

        # Upper bound for c: must be less than the smallest dose
        c_upper = float(np.min(doses)) - 0.001

        try:
            popt, _ = curve_fit(
                rational_color_model,
                doses,
                colors,
                p0=[a0, b0, c0],
                bounds=(
                    [-np.inf, -np.inf, -np.inf],
                    [np.inf, np.inf, c_upper],
                ),
                maxfev=10000,
            )
        except RuntimeError as exc:
            raise RuntimeError(
                f"Curve fitting failed for {ch_name} channel: {exc}"
            ) from exc

        # R-squared
        predicted = rational_color_model(doses, *popt)
        ss_res = np.sum((colors - predicted) ** 2)
        ss_tot = np.sum((colors - np.mean(colors)) ** 2)
        r_sq = 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0

        results[ch_name] = {
            "a": float(popt[0]),
            "b": float(popt[1]),
            "c": float(popt[2]),
            "r_squared": float(r_sq),
        }

    return results
