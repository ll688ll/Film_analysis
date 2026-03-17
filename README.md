# Radiation Film Analysis Tool

**Version 1.0.0**

A desktop application for radiochromic film dosimetry analysis. Load scanned film images, apply calibration curves to convert pixel values to dose, and analyze regions of interest (ROI) with detailed statistics.

## Quick Start (Standalone Exe)

Download `RadiationFilmAnalysis.exe` from the `dist/` folder and run it. No Python installation required.

## Development Setup

### Requirements

- Python 3.8+
- Dependencies: `numpy`, `Pillow`, `matplotlib`, `scipy`

```bash
pip install numpy Pillow matplotlib scipy
```

### Run from source

```bash
python main.py
```

### Build standalone exe

```bash
pip install pyinstaller
python build.py
```

The exe will be created at `dist/RadiationFilmAnalysis.exe`. The `calibration_config.json` file is created automatically on first run in the same directory as the exe.

## Features

### Film Analysis

1. **Load Film Scan** -- Open a scanned film image (TIF, PNG, JPG).
2. **Set DPI** -- Extracted automatically from image metadata, or enter manually. Used for physical measurement conversions.
3. **Select Calibration Profile** -- Choose from saved calibration profiles. Each profile stores parameters for Red, Green, and Blue channels.
4. **Select Channel** -- Pick Red, Green, Blue, or Gray. Parameters (a, b, c) auto-update when switching channels if the profile has per-channel calibration data.
5. **Apply Calibration / Show Dose** -- Converts the image to a dose map using the rational function model and displays it with a jet colormap.
6. **ROI Analysis** -- Draw an ROI on the dose map and get statistics:
   - **Rectangle** -- Axis-aligned or rotated (0-360 degrees)
   - **Circle** -- Elliptical region
   - **Ring** -- Annular region with adjustable hole ratio

#### ROI Statistics

| Metric | Description |
|---|---|
| Max / Min / Mean / Std | Dose values (trimmed 1-99 percentile) |
| CV (%) | Coefficient of variation |
| DUR | Dose uniformity ratio (Max/Min) |
| Flatness (%) | (Max - Min) / (Max + Min) x 100 |
| Center X/Y | ROI center position in mm |
| Width / Height | ROI dimensions in mm |
| Area | Effective ROI area in mm^2 |

### Calibration Wizard

Create new calibration profiles from multiple film scans exposed to known doses.

1. Click **Calibration Wizard...** in the main window.
2. Enter a **Profile Name** and optional **Note** (e.g., film batch, beam energy, clinic).
3. For each dose level:
   - Click **Load Film Image** to open a scanned film.
   - Enter the known **Dose (Gy)** (use 0 for unexposed reference).
   - Draw a rectangle ROI on the film.
   - Click **Add Point from ROI** -- the tool samples mean color values for all three channels (R, G, B) simultaneously.
4. Repeat step 3 for at least 4 dose levels.
5. Click **Fit Curves** -- fits the rational function to each channel and displays parameters (a, b, c) and R^2.
6. Select the **Primary Channel** (typically Red for EBT films).
7. Click **Save as Profile** -- the profile is immediately available in the main application.

### Calibration Model

The tool uses a rational function calibration model:

```
Dose = b / (Color% - a) + c
```

where `Color% = pixel_value / 255.0` and `a`, `b`, `c` are fitted parameters.

Equivalently, for curve fitting:

```
Color% = a + b / (Dose - c)
```

### Calibration Config

Profiles are stored in `calibration_config.json`:

```json
{
    "profiles": {
        "EBT4_Batch_2026": {
            "name": "EBT4 Batch 2026",
            "note": "100V, 10x10cm field, ABC clinic",
            "color_channel": "Red",
            "channels": {
                "Red":   { "a": 0.061, "b": 8.200, "c": -12.096 },
                "Green": { "a": 0.045, "b": 5.100, "c": -8.300 },
                "Blue":  { "a": 0.038, "b": 3.200, "c": -5.700 }
            }
        }
    },
    "current": "EBT4_Batch_2026"
}
```

Each profile stores per-channel calibration parameters, a default channel, and a freeform note.
