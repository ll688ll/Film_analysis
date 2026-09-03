# ROI Analysis Panel — Design

Status: implemented in v1.3.0
Scope: right-hand ROI panel on the Film Dose page, extended statistics, histogram, contour view with map overlay, dose profiles, copy/CSV export

## 1. Problem

Before v1.3.0 the Film Dose page had one 320 px left sidebar holding Upload, Calibration,
ROI Tools, Statistics, and Save. Growing the ROI analysis (a histogram, an isodose view,
profiles, more statistics) did not fit in that column, and the statistics themselves stopped
at mean/min/max/std/CV/DUR/flatness.

Two latent defects surfaced while designing the change:

| Defect | Cause |
|--------|-------|
| A rotated rectangle was analysed in the wrong place | The canvas rotated the Konva `Rect` about its top-left corner (no `offset`), while `build_roi_mask` rotates about the box centre. For a 100 × 100 ROI at 90° the analysed region sat 100 px away from the drawn one. |
| `POST /roi` could return a 500 | `get_roi_stats` yields `inf` for `dur`/`flatness` when the ROI minimum is 0; Starlette's JSON encoder refuses non-finite numbers. The `_finite` helper only guarded the save path. |
| The dose map took 30 s or more to reach the browser | `StreamingResponse(io.BytesIO(...))` iterates the buffer line by line, so every `0x0A` byte in the float32 data ended an HTTP chunk (~16k chunks for a 4 MB map, each hopping through a thread pool). The dose map, previews, and intensity plane now go out as one `Response` with a `Content-Length`. |

## 2. Goals

1. Move ROI Tools and Statistics into a right-hand panel that folds to an icon rail.
2. Add a dose histogram, an isodose contour view (with an optional overlay on the map), and
   dose profiles with FWHM and penumbra.
3. Extend the statistics with median, P2/P98, a homogeneity index, and pixel counts.
4. Copy the statistics as TSV; download histogram and profile data as CSV.
5. Keep the server the single source of truth for the mask and the statistics.

Explicitly out of scope: zoom/pan on the dose map, multiple ROIs, persisting the new
statistics in `roi_measurements`, and folding the left sidebar.

## 3. Layout and state ownership

```
┌ left aside w-80 ─┐┌──────── canvas (flex-1, min-w-0) ────────┐┌ right aside w-96 ──────────┐
│ Upload Film      ││ [cursor dose, top-left]                   ││ ROI ANALYSIS           [»] │
│ Calibration      ││          dose map + ROI + isolines        ││ ▾ ROI Tools                │
│                  ││                               [ColorBar]  ││ ┌Mean┐┌Std┐┌CV┐┌Max┐      │
│ Save Analysis    ││                  [colormap chip, bottom]  ││ Stats|Histogram|Contour|… │
└──────────────────┘└───────────────────────────────────────────┘└────────────────────────────┘
                                                   collapsed → ┌ w-10 ┐ [«] ▦ ▤ ◎ ∿
```

`AnalysisPage` keeps everything about the ROI: shape settings, the ROI box, the fetched
statistics, loading/error state, and the isolines the panel asks to overlay. `RoiPanel`
owns only display preferences, persisted under the localStorage key `filmdose.roiPanel.v1`:

```ts
{ collapsed, tab: "stats" | "histogram" | "contour" | "profiles", toolsOpen,
  contour: { mode: "percent" | "absolute", levels: 2..10, overlay, smooth } }
```

`SidePanel` (`components/SidePanel.tsx`) is the generic folding aside. Its left edge is a
drag handle (300–760 px, double-click resets to 384; the width is persisted). Only the
expanded body is mounted, so each Plotly chart sizes against a real container; it fires a
synthetic `resize` event when its width transition ends or a drag finishes because
`react-plotly.js` re-measures on window resize only. `ProtectedTabs` hides inactive pages
with `hidden`, so the panel also fires one when the page becomes visible. Because the ROI is
kept in canvas coordinates, `ImageCanvas` re-maps it onto the same film pixels whenever the
view re-fits, so resizing the panel or the window never moves the ROI off its target.

## 4. Server contract

`POST /api/analysis/{session_id}/roi` takes no new inputs. `FilmAnalyzer.get_roi_stats`
now ignores non-finite pixels, and adds to its result:

| Field | Set | Meaning |
|-------|-----|---------|
| `median`, `p2`, `p98` | trimmed | `np.percentile(trimmed, [50, 2, 98])` |
| `homogeneity_index` | trimmed | `(p98 − p2) / median`, `null` when the median is 0 |
| `trimmed_count` | trimmed | pixels the statistics used |
| `trim_low`, `trim_high` | trimmed | dose of the lowest / highest kept pixel; `null` when nothing was trimmed |
| `histogram` | all masked | `compute_dose_histogram`: 64 bins over `[min, max]` of every masked pixel, so a chart can show what the trim excluded |

The router passes `cv`, `dur`, `flatness`, and `homogeneity_index` through `_finite`, so
`null` replaces infinity. `StatsPayload` for `/save` is unchanged; pydantic ignores the
extra fields the client posts back, and reopening a saved analysis recomputes the
statistics from the dose map anyway.

## 5. Geometry

The client mirrors `build_roi_mask` in `frontend/src/analysis/roiGeometry.ts` so that the
crop and profiles cover exactly the pixels the server measures:

- `x, y, w, h` is the unrotated box in image pixels; `rotation` (degrees, clockwise on
  screen) applies about `(x + w/2, y + h/2)`. Circle and Ring use the same box.
- `makeRoiMask` evaluates membership at integer pixel coordinates like `np.ogrid`:
  rectangle with rotation and 45° chamfer (`corner_cut_px = mm · dpi / 25.4`, clamped to
  half the shorter side), ellipse, ring (`dist ≥ (hole/100)²`), then `dose > threshold`.
- `roiAxes` gives the width axis `(cos θ, sin θ)` and height axis `(−sin θ, cos θ)`;
  `roiBoundingBox` rotates the four corners and clamps to the image.

**Pivot fix.** `ImageCanvas` now renders the rectangle and its chamfer outline with
`x = cx, y = cy, offsetX = w/2, offsetY = h/2`, so Konva rotates about the centre and
`node.x()/y()` is the centre whatever the Transformer's scale. Drag and transform handlers
derive the box from that centre. The Rotation control and the on-canvas handle are kept in
step: the control rotates the current rectangle, and a handle rotation is reported back
rounded to whole degrees, which the canvas then snaps to.

## 6. Algorithms

**Crop** (`roiCrop.ts`). The axis-aligned bounding box of the ROI plus 1 px is
block-averaged with `step = ceil(max(bw, bh) / 160)`; a block counts as inside when at
least half its pixels pass the mask, otherwise it is `NaN`. Axes are block centres in mm.

**Levels** (`contourLevels.ts`). Percent mode uses presets (e.g. 5 → 20/50/80/90/95 % of the
statistics' maximum, so "95 %" agrees with the Max tile); absolute (Gy) mode spaces N levels
evenly inside the ROI range, or from a user-typed minimum to maximum inclusive. Either list
can then be edited value by value (`customPercent` / `customGy` in the preferences; the
count or range regenerates it, Reset clears it). No level is ever dropped: one outside
`(roiMin, roiMax)` simply draws no line, the legend shows all N + 1 bands and dims those
that hold no ROI pixels, and the caption says how many levels fall inside the ROI range —
silently dropping them made "10 levels" show four sections.

**Isolines** (`marchingSquares.ts`, `isolines.ts`). Standard 16-case marching squares with
linear interpolation and centre-value saddle resolution; cells touching a `NaN` are
skipped, so lines end at the mask edge instead of hugging it. Segments are joined into
polylines by quantised endpoints. With *Smooth* on, the field is averaged 3 × 3 first (film
grain otherwise crosses a nearby level thousands of times), paths shorter than 8 points are
dropped, and coarse grids get one Chaikin pass. Grid coordinates map to image pixels via
`x = x0 + gx · step + (step − 1) / 2`.

**Profiles** (`profileMetrics.ts`). Samples every pixel along the ROI's own width and height
axes, extending 25 % (at least 20 px) past each end so the penumbra is visible when the ROI
ends at the field edge; bilinear at odd angles, nearest at multiples of 90°. The lines sit at
a `ProfileOffset {u, v}` from the ROI centre (image px, owned by `AnalysisPage`, reset when a
ROI is placed and clamped to the box when it is resized): the horizontal profile runs along u
at offset v, the vertical one along v at offset u. `ImageCanvas` draws the two lines and their
crossing as a draggable crosshair while the Profiles view is open; drags are node
translations projected onto the allowed axis and clamped to the box, then folded back into
the offsets. Metrics use a 5-sample moving average: the maximum is taken *inside* the ROI extent (a
neighbouring field in the margin must not become the reference), thresholds are 0.8/0.5/0.2
of it, crossings are interpolated walking outwards from the maximum. A crossing that never
happens leaves its metric `null`, shown as a dash with a hint.

## 7. Rendering

Plotly's `contour` trace only supports evenly spaced levels, which rules out the percent
presets, so the contour view is a `heatmap` of band indices with a stepped colorscale
sampled from the active colormap, plus two scatter traces (dark under white) carrying every
isoline separated by `null`, and one annotation per level placed at a different fraction
along its longest path so labels do not pile up. The y axis is reversed and anchored to x so
millimetres are square.

On the main canvas the same isolines are stroked by two custom Konva `Shape` nodes (one path
list, dark halo under a white line) inside a non-listening `Group` rendered before the ROI
shapes, so they never take hits and the Transformer stays on top.

The histogram is a bar trace at bin centres; bins outside `[trim_low, trim_high]` are grey,
the excluded tails are shaded, and mean/median/cutoffs are drawn as shapes. Profiles are two
stacked line charts with the ROI extent shaded, 80/50/20 % guides, and the 50 % crossings.

## 8. Recompute discipline

Client-side work is memoised on the dose `Float32Array` (not on `doseMapData`, whose
identity changes on every colormap repaint), the ROI box, the mask options, and the DPI.
The crop is only computed while the overlay is on or the Contour view is visible; profiles
only while the Profiles view is visible. Statistics and the histogram share the existing
300 ms debounce and now also refresh when the ROI type, hole ratio, or threshold changes.

## 9. Edge cases

| Case | Behaviour |
|------|-----------|
| Threshold excludes every pixel | Server 400 → statistics cleared, message shown under the tiles on every view, overlay cleared |
| Ring hole | `NaN` in the crop → isolines stop at the hole; profile samples are flagged `in_roi = false` |
| ROI entirely inside a flat field | Low percent levels fall outside the ROI range and are dropped; profiles never cross 50 % → FWHM shown as a dash with a hint |
| ROI partly outside the image | Bounding box clamps; out-of-image profile samples are skipped |
| Constant ROI | Histogram window padded ±0.5 so its single bar lands mid-chart; HI = 0 |
| Page opened on another tab first | `ImageCanvas` waits for a measured container before placing a restored ROI |
| `localStorage` unavailable | Preferences degrade to in-memory state |

## 10. Files

Backend: `app/services/film_analyzer.py` (`compute_dose_histogram`, extended
`get_roi_stats`), `app/routers/analysis.py` (`_finite` on the ROI response), tests in
`tests/test_services.py` and `tests/test_analysis.py`.

Frontend: `analysis/RoiPanel.tsx`, `SummaryTiles.tsx`, `CollapsibleSection.tsx`,
`StatsPanel.tsx`, `RoiHistogram.tsx`, `RoiContour.tsx`, `RoiProfiles.tsx`, `ROIControls.tsx`,
`ImageCanvas.tsx`, `AnalysisPage.tsx`; pure modules `roiTypes.ts`, `roiGeometry.ts`,
`roiCrop.ts`, `contourLevels.ts`, `marchingSquares.ts`, `isolines.ts`, `profileMetrics.ts`,
`roiExport.ts`, `plotTheme.ts`, `format.ts`, `panelIcons.tsx`; shared
`components/SidePanel.tsx` and `components/usePersistedState.ts`.
