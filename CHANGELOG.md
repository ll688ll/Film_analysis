# Changelog

All notable changes to the Film Analysis tool are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.2.0] - 2026-08-13

Analysis history expansion: saved analyses now keep the film data and the
calibration behind them, live in project folders, and can be reopened to
continue a study.

### Added

- **Project folders.** A flat, per-user set of projects; each saved analysis
  belongs to one or is left "Unfiled". Full CRUD at `/api/projects`, with the
  History page grouping analyses into collapsible sections and offering
  create/rename/delete plus a move-to-project selector on each row. Deleting a
  project unfiles its analyses; it never deletes them.
- **The original film is stored with the analysis.** Saving copies the scan into
  storage the record owns (`uploads/{user_id}/saved/`), so the analysis stays
  openable long after the 30-minute in-memory cache expires. Downloadable from
  History via `GET /api/analysis/saved/{id}/file`.
- **Calibration profile snapshot.** Every save records the profile name, note,
  primary channel, all channel coefficients (with R²), and the calibration
  points as immutable JSON. Editing or deleting the profile afterwards no longer
  alters or orphans the saved analysis; History marks such profiles "deleted"
  but keeps showing the name.
- **Resume a saved analysis.** "Open" in History rehydrates the film into a fresh
  working session (`POST /api/analysis/saved/{id}/open`) and restores the whole
  page: calibration, ROI geometry and options, colormap, display range, notes,
  and project. Saving then offers **Update Saved** (overwrite the record) or
  **Save as New** (fork it, for comparing variations of one study).
- **ROI geometry and results are persisted.** Saving stores the ROI type,
  position, rotation, hole ratio, threshold, trim and corner-cut settings, and
  the computed dose statistics.
- **Delete a saved analysis** (`DELETE /api/analysis/saved/{id}`), which also
  removes the film file it owns unless another analysis references the same
  file. The History button is no longer disabled.
- **Edit notes and move between projects from History**, without reopening the
  analysis (`PATCH /api/analysis/saved/{id}`).
- **Application version** is now defined once in `backend/app/config.py`,
  reported by `GET /api/health`, and shown next to the app title in the UI.
- Startup schema migrations (`backend/app/migrations.py`) so new columns reach
  databases that already exist; `create_all` only ever created missing tables.
- Startup sweep of uploads older than 24 hours that no saved analysis claimed.
- Design document at `docs/analysis-history-design.md`.

### Changed

- `POST /api/analysis/{session_id}/save` accepts the display range, colormap,
  project, ROI, statistics, and an optional `analysis_id` to overwrite. All new
  fields are optional; the previous request body still works.
- `GET /api/analysis/history` returns the project, a resolved profile object,
  image dimensions, colormap, and `has_roi` / `has_file` flags.
- CSV export moved from `GET /api/analysis/{session_id}/export` to
  `GET /api/analysis/saved/{analysis_id}/export`, and gained a metadata header
  plus the trim, corner-cut, and pixel-count columns.
- Deleting a calibration profile now explicitly clears the reference from
  analyses that used it, rather than relying on database-level cascade.
- `backend/app/schemas.py` holds only the auth contract. Its analysis, profile,
  and wizard models were unused and described an obsolete API shape.

### Fixed

- Saved analyses recorded the storage UUID as the original filename; the name
  the user uploaded is now kept.
- CSV export always produced a header-only file, because ROI measurements were
  never written to the database.
- The History page's Profile column showed "N/A" for every row: it expected a
  nested profile object the API did not return.
- The display range saved with an analysis could be stale, taken from the value
  set at calibration time rather than the current one.
- `GET /api/analysis/{id}/export` returned a 500 for a non-numeric id; saved
  routes now take a typed integer and return 422.
- The analysis page never revoked its preview blob URLs, leaking image data for
  the lifetime of the session.

## [1.1.0] - 2026-06-11

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
