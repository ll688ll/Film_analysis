# Changelog

All notable changes to the Film Analysis tool are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] - 2026-06-11

### Added

- **Remove max/min values (trim) option** in ROI Tools, available for all ROI
  shapes (Rectangle, Circle, Ring). When enabled, a user-defined percentage
  (default 2%) of the highest and lowest dose values is excluded from each
  tail before statistics are computed, reducing the influence of film noise
  on max, min, mean, std, CV, DUR, and flatness.
- **Remove corners option** for Rectangle ROIs. The user defines a corner
  length in mm; a 45° diagonal chamfer of that length is cut from each corner
  (converted to pixels via the scan DPI) and the cut pixels are excluded from
  statistics, pixel count, and area. Works with rotated rectangles; the
  length is clamped to half the shorter side. The analyzed region is shown
  on the canvas as an orange dashed octagon inside the ROI rectangle.
- **Dose color bar legend** on the film analysis canvas. A vertical gradient
  rendered from the same colormap lookup table as the dose map (jet, viridis,
  hot) with six dose tick labels in Gy, tracking the Display Min/Max range
  live.
- Statistics panel caption showing the active trim percentage and corner cut
  length, so exported screenshots are self-documenting.
- New API fields on `POST /api/analysis/{session_id}/roi` (all optional and
  backward compatible): `trim_enabled`, `trim_percent`, `corner_cut_enabled`,
  `corner_cut_mm`. The response echoes the applied values.

### Changed

- ROI statistics no longer silently trim 1% from each tail. Trimming is now
  fully user-controlled: with the option off, statistics use **all** pixels
  in the ROI. Results may differ slightly from earlier versions at the
  extremes (max/min/DUR/flatness).

### Fixed

- `extract_color_percentages` channel values are documented and tested as
  0–1 fractions, matching the `pixel / 255` scale used by the rational
  calibration function.
- Backend test suite no longer skips the API tests on non-Windows machines:
  the test film path is resolved relative to the repository
  (`test/CAL_007.tif`) and can be overridden with the `TEST_FILM_PATH`
  environment variable.

## [0.1.0] - 2026-03-16 to 2026-06-11

Initial development.

### Added

- Radiation film analysis desktop tool with rational-function dose
  calibration (2026-03-16).
- Calibration wizard for creating calibration profiles from film scans
  (2026-03-17).
- Web service: FastAPI backend (upload, calibrate, ROI statistics, save,
  export) with PostgreSQL persistence, and a React frontend with interactive
  dose map, ROI selection (Rectangle/Circle/Ring with rotation, hole ratio,
  and dose threshold), colormap selection, and cursor dose readout
  (2026-03-18).
- Calibration state management and inline calibration profile editing in the
  analysis page (2026-06-11).
