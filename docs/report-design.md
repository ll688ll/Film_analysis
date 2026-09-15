# Interactive HTML Report — Design

Status: implemented in v1.6.0
Scope: a self-contained, interactive `.html` report of one film dose analysis, exported from
the Film Dose page

## 1. Problem

Before v1.6.0 the only things that left the application were CSV files: the ROI statistics,
the histogram bins, the profile samples. A colleague without an account could not see the dose
map, the ROI on it, the isodose map or the profiles, and a CSV cannot carry the calibration that
produced the numbers. Screenshots lose the numbers; PDFs lose the interaction.

The user's target is a **local file**: something to attach to an e-mail, drop in a shared
folder, or archive with the film scan. No server-hosted reports or share links.

## 2. Goals

1. One `.html` file per analysis that opens in any browser with no server, no login and no
   network, and prints to PDF from the browser.
2. The file stays interactive: recolour and re-window the dose map, read the dose under the
   cursor, toggle the ROI, isodose and profile-line outlines, hover and zoom the charts, change
   the contour levels, copy statistics, download the CSVs.
3. What the reader sees is what the analyst saw: the same statistics, the same figures.
4. The file states its own provenance: the calibration (with the fitted curve and points when
   they exist), the scan's bit depth, the ROI options, the app version, and how the embedded
   data was reduced.
5. A 1200 dpi, 48-bit scan must still give a file of a few megabytes.

Explicitly out of scope: share links or server-side storage of reports, a report covering several
analyses, a server-side (Python) renderer.

## 3. Decision: generate in the browser

Everything a report needs is already in the Film Dose page:

| Content | Where it lives |
|---------|----------------|
| Dose map | `useDoseMap` holds the full `Float32Array` |
| Statistics, percentiles, histogram | The last `POST /roi` response |
| Contours, profiles, FWHM, penumbra | Pure TypeScript modules (`roiCrop.ts`, `isolines.ts`, `profileMetrics.ts`, …) |
| Calibration provenance | The reopened analysis's snapshot, or the live profile |

A server-side report would have had to reload the film, recalibrate, and re-implement the
contour and profile mathematics in Python (the saved `roi_measurements` row holds only the basic
statistics, and the dose map is never stored), and the two implementations would drift. So the
page builds a **payload** (§4), fetches the prebuilt **viewer** (§6) from its own origin, and
writes one HTML file with the viewer's stylesheet and script inlined around the payload.

The payload is a versioned contract (`REPORT_SCHEMA`). A later share-link feature would store
the same payload server-side and wrap it in the same viewer; nothing here would change.

## 4. Payload

`frontend/src/report/reportTypes.ts`. Built by `buildReport.ts` from a `ReportSource` that
`AnalysisPage` assembles from its state.

| Field | Content |
|-------|---------|
| `meta` | Title, author, institution, comment from the export dialog |
| `film` | Filename, size, DPI, channels, bit depth, notes, project name, saved-analysis id |
| `filmThumbnail` | JPEG data URL of the preview, at most 800 px a side |
| `calibration` | Profile name and note, `source` (§7), the applied channel and a/b/c, every channel's a/b/c/R², the calibration points |
| `display` | Colormap and range at export time; the reader's starting point |
| `doseGrid` | The dose map, block-averaged and quantised (§5) |
| `roi` | Geometry and options, the server statistics with histogram, the 160-block crop for contours, the contour settings, the profile offset, and both sampled profiles |

Arrays that are not plain JSON (`doseGrid`, the crop's `z`) travel as `EncodedBytes`:
little-endian bytes through a `DataView`, gzip via the browser's `CompressionStream` when it
exists (`"gzip-base64"`), plain base64 otherwise. The viewer inflates with `DecompressionStream`
and shows a message instead of the map on a browser without it. No compression library is
bundled.

## 5. Size budget

A 300 dpi film is ~3 M dose values, a 1200 dpi scan 45 M; neither belongs in an HTML file.

- **Dose grid.** `blockMeanGrid` averages `step × step` blocks so the longer side is at most
  800 blocks (a 1016 px film: 2 × 2 → 508 × 508; a 6528 px scan: 9 × 9 → 726 × 765).
  `chooseQuantRange` spans the central 99 % of the block means, widened to include the display
  range and the ROI minimum and maximum, so the ROI is exact and the handful of wild values at
  the film edge and scanner bed (the calibration's pole) do not spend the 16-bit range on
  nothing. Values outside are clamped, the payload says so (`clamped`), and the viewer shows
  such a readout as `≥ hi`. Code 65535 marks a block with no finite pixel.
- **Crop.** The same 160-block crop the contour view uses, as float32 (NaN outside the ROI).
- **Profiles.** Positions to 3 decimals, doses to 5, as JSON.
- **Thumbnail.** JPEG, quality 0.85, at most 800 px.

Measured on `test/CAL_007.tif` (1016 × 1016, 16-bit): payload 530 kB (dose grid 445 kB,
thumbnail 39 kB, crop 32 kB), viewer 1.65 MB, file 2.2 MB, built in under a second.

The viewer's size is Plotly. The app now imports `plotly.js/dist/plotly-cartesian` (1.4 MB
minified) through `react-plotly.js/factory` instead of the full `plotly.js/dist/plotly`
(4.8 MB); every chart is a bar, scatter or heatmap, all in the cartesian build. The app bundle
drops from 5.5 MB to about 2 MB as a side effect, and the report shares the single `Plot`
component (`components/Plot.tsx`).

## 6. Viewer build

`src/report/main.tsx` reads the JSON block `#film-report-data`, decodes the arrays once, and
renders `ReportApp` into `#film-report`. `vite.report.config.ts` builds it in library mode as
one IIFE (`public/report/report.js`) and one stylesheet (`public/report/report.css`), with
`publicDir: false` so the output is not copied into itself. `process.env.NODE_ENV` is defined
by hand because library builds do not get Vite's replacement and React needs it.

- `npm run build:report` builds the viewer; `prebuild` runs it before `npm run build`, so the
  Docker image contains `dist/report/`. `predev` runs `scripts/ensure-report-viewer.mjs`, which
  builds once if the files are missing; after editing `src/report/` in development, rebuild by
  hand.
- `public/report/` is gitignored.
- At export time `assembleReport.ts` fetches `/report/report.js` and `/report/report.css` from
  the app's origin. A dev server or nginx answers a missing file with the SPA's `index.html`,
  so the fetch checks the content type and reports "The report viewer is not built" rather than
  producing a file that shows a blank app.

The HTML is `<style>css</style>`, `<div id="film-report">`, the JSON block, then
`<script>js</script>`. The JSON has `<`, U+2028 and U+2029 escaped so no string it carries can
end the block; `</script` and `<!--` inside the viewer script are escaped the same way
`plotly.write_html` does it.

## 7. Same figures, two themes

The Plotly figures for the histogram, the contour map and the profiles were inside the three
panel components. They are now pure functions in `analysis/roiCharts.ts` taking a `PlotPalette`
(`plotTheme.ts`): the panel passes `DARK_PALETTE`, the report `LIGHT_PALETTE` with a light layout.
The contour levels, isolines and profile metrics are computed in the report from the embedded
crop and profiles with the same modules the panel uses, so changing the level count in a report
gives the lines the panel would draw. `DEFAULT_CONTOUR_SETTINGS` (in `contourLevels.ts`) is the
one definition of the contour view's defaults, shared by the panel, the page and the viewer.

The calibration curve reuses `wizard/CurveChart.tsx` unchanged.

**Calibration source.** The report prefers the immutable snapshot of a reopened analysis
(`source: "snapshot"`), kept by `AnalysisPage` only while the applied coefficients are still the
ones it describes; applying a different calibration drops it. Otherwise the live profile from
`GET /profiles` (`"profile"`), which now carries `r_squared` per channel and the
`calibration_points`; otherwise the hand-entered numbers (`"manual"`). The Calibration section
says which.

## 8. Page

Light theme, one column, at most 5xl wide: header (title, author · institution · date, Print
button), a sticky section nav, then Summary (tiles, comment, facts), Dose map (scan and dose map
side by side with the same SVG overlay; colormap, range, Reset, three outline toggles; cursor
readout; horizontal colour bar), ROI statistics (two-column table, click-to-copy, Copy TSV),
Histogram (CSV), Isodose contours (mode, count, Gy range, smooth, overlay-on-map, legend),
Profiles (CSV), Calibration (table with the applied channel marked, curve), Method (formula,
ROI options, what the embedded data is), footer. Controls carry `no-print`; `@page` is A4 with
12 mm margins; sections avoid page breaks and Calibration starts a new page.

The dose map is a `<canvas>` of the grid, recoloured with the app's `applyColormap`, under an
SVG whose `viewBox` is in image pixels (`cols × step` by `rows × step`), so the ROI geometry,
the isolines and the profile lines are drawn in the coordinates they were computed in;
`vector-effect: non-scaling-stroke` keeps line widths in screen pixels. The scan thumbnail gets
the same overlay with `viewBox` = image size.

## 9. Edge cases

| Situation | Behaviour |
|-----------|-----------|
| No ROI, or statistics failed | Report holds the dose map and calibration; Summary says so; ROI sections and their nav links are absent |
| Statistics still computing | The dialog's download button waits |
| Viewer not built | Export fails with "The report viewer is not built. Run `npm run build:report`" |
| Preview blob unavailable | `filmThumbnail` null; the dose map takes the full width |
| No `CompressionStream` when exporting | Arrays stored as plain base64; the file is larger but valid |
| No `DecompressionStream` when reading | The map area shows the reason; every other section works |
| Wild dose values at the film edge | Clamped to the quantisation range; caption and Method say so and give the true extremes |
| Profile deleted after the analysis was saved | `source: "snapshot"` keeps the name, coefficients and points |
| Imported legacy profile | No points; the Calibration section shows the table and says why there is no curve |
| `</script` in a note or filename | Escaped; cannot end the JSON block |

## 10. Files

Backend: `app/services/film_analyzer.py` (`bit_depth`), `app/routers/analysis.py` (`bit_depth`
in upload and open), `app/routers/profiles.py` (`r_squared`, `calibration_points` in
`ProfileOut`), `app/routers/wizard.py` (stores R²); tests in `tests/test_analysis.py`,
`tests/test_saved_analysis.py`, `tests/test_wizard.py`.

Frontend: `report/reportTypes.ts`, `report/encode.ts`, `report/doseGrid.ts`,
`report/buildReport.ts`, `report/assembleReport.ts`, `report/main.tsx`, `report/ReportApp.tsx`,
`report/ui.tsx`, `report/report.css`, `report/views/*`; `analysis/ReportDialog.tsx`,
`analysis/roiCharts.ts`, `analysis/plotTheme.ts`, `analysis/AnalysisPage.tsx`,
`analysis/RoiPanel.tsx`, `analysis/RoiHistogram.tsx`, `analysis/RoiContour.tsx`,
`analysis/RoiProfiles.tsx`, `analysis/contourLevels.ts`, `analysis/CalibrationPanel.tsx`,
`api/analysisTransfer.ts`, `components/Plot.tsx`, `types/plotly-cartesian.d.ts`;
`vite.report.config.ts`, `scripts/ensure-report-viewer.mjs`, `package.json`.
