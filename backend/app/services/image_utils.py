"""Image loading and preview generation utilities."""

import io

import numpy as np
from PIL import Image
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def load_image(filepath):
    """
    Load an image from disk.

    Parameters
    ----------
    filepath : str
        Path to the image file.

    Returns
    -------
    tuple
        (image_array, dpi, width, height, channels)
        - image_array: np.ndarray of pixel data
        - dpi: float (defaults to 72.0 if not embedded)
        - width: int (pixels)
        - height: int (pixels)
        - channels: int (1 for grayscale, 3+ for colour)
    """
    img = Image.open(filepath)
    image_array = np.array(img)

    dpi = 72.0
    if "dpi" in img.info:
        dpi = float(img.info["dpi"][0])

    height, width = image_array.shape[:2]
    channels = 1 if image_array.ndim == 2 else image_array.shape[2]

    return image_array, dpi, width, height, channels


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

    Returns
    -------
    bytes
        JPEG-encoded image bytes.
    """
    img = Image.fromarray(image_array)

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
