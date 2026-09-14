"""Image loading and preview generation utilities."""

import io

import numpy as np
from PIL import Image, UnidentifiedImageError
from tifffile import TiffFileError
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from app.services.image_io import pillow_truncates, read_tiff_full_depth


def load_image(filepath):
    """
    Load a film scan from disk.

    Parameters
    ----------
    filepath : str
        Path to the image file.

    Returns
    -------
    tuple
        (image_array, dpi, width, height, channels)
        - image_array: np.ndarray of pixel data at the file's bit depth:
          ``uint8`` for an 8-bit scan, ``uint16`` for a 16-bit-per-channel
          one (Pillow alone would keep only the high byte of a 48-bit TIFF)
        - dpi: float (defaults to 72.0 if not embedded)
        - width: int (pixels)
        - height: int (pixels)
        - channels: int (1 for grayscale, 3+ for colour)

    Raises
    ------
    ValueError
        If the file is not a decodable image, or is large enough to trip
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
        dpi = 72.0
        if "dpi" in img.info:
            dpi = float(img.info["dpi"][0])

        try:
            if pillow_truncates(img):
                image_array = read_tiff_full_depth(filepath)
            else:
                image_array = np.array(img)
        except (OSError, ValueError, TiffFileError) as exc:
            raise ValueError(f"Could not decode image data: {exc}") from exc

    height, width = image_array.shape[:2]
    channels = 1 if image_array.ndim == 2 else image_array.shape[2]

    return image_array, dpi, width, height, channels


def block_mean(image_array, factor):
    """
    Shrink *image_array* by an integer *factor* on both axes, averaging each
    ``factor x factor`` block.

    Trailing rows and columns that do not fill a whole block are dropped.
    Integer input comes back rounded to the same dtype, so a colour
    percentage measured on the result matches one measured over the same
    area of the original. Works as a strided reduction: shrinking a 45 MP
    48-bit scan by 4 peaks at ~64 MB.
    """
    arr = np.asarray(image_array)
    factor = int(factor)
    if factor <= 1:
        return arr

    h, w = arr.shape[:2]
    h2, w2 = (h // factor) * factor, (w // factor) * factor
    if h2 == 0 or w2 == 0:
        raise ValueError(f"Image is smaller than one {factor}x{factor} block")

    blocks = arr[:h2, :w2].reshape(
        h2 // factor, factor, w2 // factor, factor, *arr.shape[2:]
    )
    out = blocks.mean(axis=(1, 3), dtype=np.float64)
    if np.issubdtype(arr.dtype, np.integer):
        return np.rint(out).astype(arr.dtype)
    return out.astype(arr.dtype)


def _to_uint8(image_array):
    """
    Return *image_array* as ``uint8``, min/max stretching if it is not
    already 8-bit. ``uint8`` input is returned unchanged.
    """
    arr = np.asarray(image_array)
    if arr.dtype == np.uint8:
        return arr

    if np.issubdtype(arr.dtype, np.integer):
        # No NaN/inf to guard against, and float32 halves the temporaries.
        lo, hi = int(arr.min()), int(arr.max())
        if hi <= lo:
            return np.zeros(arr.shape, dtype=np.uint8)
        stretched = (arr.astype(np.float32) - np.float32(lo)) * np.float32(255.0 / (hi - lo))
        return np.clip(stretched, 0, 255).astype(np.uint8)

    a = arr.astype(np.float64)
    finite = np.isfinite(a)
    if not finite.any():
        return np.zeros(a.shape, dtype=np.uint8)

    lo = float(a[finite].min())
    hi = float(a[finite].max())
    scale = 255.0 / (hi - lo) if hi > lo else 0.0
    stretched = (np.nan_to_num(a, nan=lo, posinf=hi, neginf=lo) - lo) * scale
    return np.clip(stretched, 0, 255).astype(np.uint8)


def generate_preview(image_array, max_width=2000):
    """
    Create a JPEG preview of the given image, down-scaled if wider than
    *max_width*.

    Parameters
    ----------
    image_array : np.ndarray
        Source pixel data (H, W) or (H, W, C).
    max_width : int
        Maximum width in pixels for the preview.

    Non-``uint8`` input (16-bit scans, float arrays) is min/max stretched to
    8-bit first: ``Image.fromarray`` maps ``uint16`` to mode ``I;16``, which
    cannot be converted to RGB for JPEG output.

    Returns
    -------
    bytes
        JPEG-encoded image bytes.
    """
    arr = np.asarray(image_array)

    # Shrink by block averaging *before* any dtype conversion: an 8-bit copy
    # of a 45 MP 48-bit scan at full size would cost gigabytes in temporaries.
    # The integer factor never takes the width below max_width, so LANCZOS
    # still does the final step.
    factor = arr.shape[1] // max_width
    if factor > 1:
        arr = block_mean(arr, factor)

    img = Image.fromarray(_to_uint8(arr))

    if img.width > max_width:
        ratio = max_width / img.width
        new_size = (max_width, int(img.height * ratio))
        img = img.resize(new_size, Image.LANCZOS)

    # Ensure RGB for JPEG output
    if img.mode != "RGB":
        img = img.convert("RGB")

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def generate_dose_map_preview(dose_map, cmap_min, cmap_max, colormap="jet"):
    """
    Render a colourised dose-map image with a colour bar.

    Parameters
    ----------
    dose_map : np.ndarray
        2-D array of dose values.
    cmap_min : float
        Lower bound of the colour-map range.
    cmap_max : float
        Upper bound of the colour-map range.
    colormap : str
        Matplotlib colourmap name (default ``"jet"``).

    Returns
    -------
    bytes
        PNG-encoded image bytes.
    """
    fig, ax = plt.subplots(figsize=(8, 6))
    im = ax.imshow(
        dose_map,
        cmap=colormap,
        vmin=cmap_min,
        vmax=cmap_max,
        aspect="equal",
    )
    fig.colorbar(im, ax=ax, label="Dose")
    ax.set_title("Dose Map")
    ax.axis("off")

    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", dpi=100)
    plt.close(fig)
    return buf.getvalue()
