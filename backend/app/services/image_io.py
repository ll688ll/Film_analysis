"""Robust image loading for the general image-analysis page.

:func:`app.services.image_utils.load_image` was written for flatbed scans of
radiochromic film and assumes an 8-bit RGB TIFF. This module handles the
arbitrary images a general analysis page receives, normalising the PIL modes
whose raw arrays would otherwise silently produce meaningless numbers.

The most damaging case is palette images (GIF, PNG-8): ``np.array(img)`` on a
mode-``P`` image returns *palette indices*, not colours, so every intensity
statistic would be wrong with no error raised.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

# Modes that must be converted before the array is meaningful.
#   P / PA  -> palette indices instead of colour
#   1       -> boolean array
#   CMYK    -> four channels that are not RGB(A)
#   YCbCr / LAB / HSV -> not RGB despite having three channels
# Metadata tags used to tell a declared resolution from a Pillow default.
_JFIF_UNIT_NONE = 0
_TIFF_X_RESOLUTION = 282
_TIFF_RESOLUTION_UNIT = 296
_TIFF_UNIT_NONE = 1

_MODE_CONVERSIONS = {
    "P": "RGBA",
    "PA": "RGBA",
    "1": "L",
    "CMYK": "RGB",
    "YCbCr": "RGB",
    "LAB": "RGB",
    "HSV": "RGB",
}


@dataclass
class LoadedImage:
    """Normalised pixel data plus the metadata the UI needs to stay honest."""

    array: np.ndarray
    """(H, W) or (H, W, C). Includes the alpha channel when present."""

    alpha: np.ndarray | None
    """(H, W) alpha plane, or None when the image is fully opaque."""

    dpi: float
    has_dpi: bool
    """False when *dpi* is the 72.0 fallback. Physical units must be hidden."""

    width: int
    height: int
    channels: int
    mode: str
    """PIL mode after normalisation."""

    original_mode: str
    dtype: str
    n_frames: int

    def as_meta(self) -> dict:
        """JSON-serialisable metadata for an API response."""
        return {
            "width": self.width,
            "height": self.height,
            "dpi": self.dpi,
            "has_dpi": self.has_dpi,
            "channels": self.channels,
            "mode": self.mode,
            "original_mode": self.original_mode,
            "dtype": self.dtype,
            "has_alpha": self.alpha is not None,
            "n_frames": self.n_frames,
        }


def _read_dpi(img: Image.Image) -> tuple[float, bool]:
    """
    Return ``(dpi, has_dpi)``.

    Pillow reports a *synthesized* dpi for files that declare no physical
    resolution -- ``(72, 72)`` for JPEG, ``(1, 1)`` for TIFF. Trusting either
    would put fabricated mm measurements in the level table, so both are
    detected from the underlying tags rather than by value.
    """
    # JFIF unit 0: the density pair is an aspect ratio, not a resolution.
    if img.info.get("jfif_unit") == _JFIF_UNIT_NONE:
        return 72.0, False

    if img.format == "TIFF":
        tags = getattr(img, "tag_v2", None) or {}
        # No XResolution at all -- Pillow falls back to (1, 1).
        if _TIFF_X_RESOLUTION not in tags:
            return 72.0, False
        # ResolutionUnit 1 means "no absolute unit". An *absent* unit is not
        # the same thing: the TIFF default is inches, which real scans rely on.
        if tags.get(_TIFF_RESOLUTION_UNIT) == _TIFF_UNIT_NONE:
            return 72.0, False

    raw = img.info.get("dpi")
    if not raw:
        return 72.0, False
    try:
        value = float(raw[0])
    except (TypeError, ValueError, IndexError):
        return 72.0, False
    if not np.isfinite(value) or value <= 0:
        return 72.0, False
    return value, True


def read_dpi(filepath: str) -> tuple[float, bool]:
    """
    Read just the DPI of *filepath*, without decoding pixels.

    Lets the film path record whether its DPI is real or the 72.0 fallback,
    so a session handed to the image page does not report a fabricated
    physical scale. ``Image.open`` only parses the header here.
    """
    try:
        with Image.open(filepath) as img:
            return _read_dpi(img)
    except (OSError, ValueError):
        return 72.0, False


def _split_alpha(array: np.ndarray, mode: str) -> np.ndarray | None:
    """Return the alpha plane for RGBA / LA images, else None."""
    if array.ndim != 3:
        return None
    if mode == "RGBA" and array.shape[2] >= 4:
        return array[:, :, 3]
    if mode == "LA" and array.shape[2] >= 2:
        return array[:, :, 1]
    return None


def load_image_general(filepath: str) -> LoadedImage:
    """
    Load *filepath* into a normalised :class:`LoadedImage`.

    Applies, in order: frame 0 selection, EXIF orientation, and mode
    normalisation (see :data:`_MODE_CONVERSIONS`).

    Raises
    ------
    ValueError
        If the file cannot be decoded as an image, or is large enough to trip
        Pillow's decompression-bomb guard.
    """
    try:
        img = Image.open(filepath)
    except UnidentifiedImageError as exc:
        raise ValueError("File is not a recognised image format") from exc
    except Image.DecompressionBombError as exc:
        raise ValueError("Image is too large to process safely") from exc
    except OSError as exc:
        raise ValueError(f"Could not read image: {exc}") from exc

    with img:
        original_mode = img.mode
        n_frames = int(getattr(img, "n_frames", 1) or 1)
        dpi, has_dpi = _read_dpi(img)

        if n_frames > 1:
            img.seek(0)

        # Phone photos carry an EXIF orientation tag; without this the image
        # is displayed and analysed rotated relative to how the user sees it.
        try:
            img = ImageOps.exif_transpose(img) or img
        except (OSError, ValueError, KeyError):
            pass  # malformed EXIF -- keep the untransposed image

        target = _MODE_CONVERSIONS.get(img.mode)
        if target is not None:
            # Palette images only carry transparency when the file declares it;
            # converting an opaque palette to RGBA would fabricate an alpha
            # channel that is uniformly 255, so prefer RGB in that case.
            if target == "RGBA" and "transparency" not in img.info:
                target = "RGB"
            img = img.convert(target)

        mode = img.mode
        try:
            array = np.array(img)
        except (OSError, ValueError) as exc:
            raise ValueError(f"Could not decode image data: {exc}") from exc

    if array.ndim not in (2, 3):
        raise ValueError(f"Unsupported image shape {array.shape}")
    if array.size == 0:
        raise ValueError("Image contains no pixels")

    if array.dtype == np.bool_:
        array = array.astype(np.uint8) * 255

    height, width = array.shape[:2]
    channels = 1 if array.ndim == 2 else array.shape[2]

    return LoadedImage(
        array=array,
        alpha=_split_alpha(array, mode),
        dpi=dpi,
        has_dpi=has_dpi,
        width=width,
        height=height,
        channels=channels,
        mode=mode,
        original_mode=original_mode,
        dtype=str(array.dtype),
        n_frames=n_frames,
    )
