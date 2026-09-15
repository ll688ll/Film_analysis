import { useMemo } from "react";
import Plot from "../../components/Plot";
import { sampleColormap, type ColormapName } from "../../analysis/colormaps";
import { MAX_LEVELS, MIN_LEVELS, clampLevelCount, type ContourLevels } from "../../analysis/contourLevels";
import { fmt } from "../../analysis/format";
import { LIGHT_PALETTE, PLOT_CONFIG, PLOT_LIGHT_AXIS, PLOT_LIGHT_LAYOUT } from "../../analysis/plotTheme";
import { contourFigure } from "../../analysis/roiCharts";
import type { RoiCrop } from "../../analysis/roiCrop";
import type { ContourSettings, Isoline } from "../../analysis/roiTypes";
import { buttonClass, Caption, inputClass, Section, segmentClass } from "../ui";

interface ContourViewProps {
  crop: RoiCrop | null;
  levels: ContourLevels | null;
  isolines: Isoline[] | null;
  colormap: ColormapName;
  dpi: number;
  refMax: number | null;
  settings: ContourSettings;
  onSettingsChange: (patch: Partial<ContourSettings>) => void;
  overlayOnMap: boolean;
  onOverlayOnMapChange: (v: boolean) => void;
}

/** Isodose map of the ROI: stepped bands from the colormap plus labelled isolines. */
export default function ContourView({
  crop,
  levels,
  isolines,
  colormap,
  dpi,
  refMax,
  settings,
  onSettingsChange,
  overlayOnMap,
  onOverlayOnMapChange,
}: ContourViewProps) {
  const n = levels?.levels.length ?? 0;
  const percent = settings.mode === "percent";
  const customKey = percent ? "customPercent" : "customGy";
  const bandColors = useMemo(() => sampleColormap(colormap, n + 1, "center"), [colormap, n]);

  const plot = useMemo(
    () =>
      crop && levels
        ? contourFigure(crop, levels, isolines, bandColors, dpi, settings.smooth, LIGHT_PALETTE)
        : null,
    [crop, levels, isolines, bandColors, dpi, settings.smooth]
  );

  const insideCount =
    crop && levels ? levels.levels.filter((L) => L > crop.roiMin && L < crop.roiMax).length : 0;
  const customRange = settings.rangeMin != null || settings.rangeMax != null;
  const badRange =
    !percent &&
    settings.rangeMin != null &&
    settings.rangeMax != null &&
    !(settings.rangeMax > settings.rangeMin);

  const message = !crop
    ? "No ROI pixels to contour."
    : badRange
      ? "The range maximum must be above its minimum."
      : levels && levels.levels.length === 0
        ? "No contour levels — set a range or a level count."
        : null;

  return (
    <Section id="isodose" title="Isodose contours">
      <div className="no-print flex flex-wrap items-center gap-x-4 gap-y-2 mb-3 text-xs text-slate-700">
        <div className="flex rounded-md overflow-hidden border border-slate-300 w-40">
          <button type="button" onClick={() => onSettingsChange({ mode: "percent" })} className={segmentClass(percent)} title="Levels as a percentage of the ROI maximum">
            % of max
          </button>
          <button type="button" onClick={() => onSettingsChange({ mode: "absolute" })} className={segmentClass(!percent)} title="Levels in Gy">
            Gy
          </button>
        </div>
        <label className="inline-flex items-center gap-1.5">
          Levels
          <input
            type="number"
            min={MIN_LEVELS}
            max={MAX_LEVELS}
            value={levels?.custom ? levels.values.length : settings.levels}
            onChange={(e) =>
              onSettingsChange({
                levels: clampLevelCount(Number(e.target.value)),
                [customKey]: null,
              } as Partial<ContourSettings>)
            }
            className={`w-14 ${inputClass}`}
          />
        </label>
        {!percent && (
          <label className="inline-flex items-center gap-1.5">
            Range
            <input
              type="number"
              step={0.1}
              value={settings.rangeMin ?? ""}
              placeholder={crop ? crop.roiMin.toFixed(2) : "min"}
              onChange={(e) => onSettingsChange({ rangeMin: e.target.value === "" ? null : Number(e.target.value), customGy: null })}
              className={`w-20 ${inputClass}`}
              aria-label="Lowest level (Gy)"
            />
            –
            <input
              type="number"
              step={0.1}
              value={settings.rangeMax ?? ""}
              placeholder={crop ? crop.roiMax.toFixed(2) : "max"}
              onChange={(e) => onSettingsChange({ rangeMax: e.target.value === "" ? null : Number(e.target.value), customGy: null })}
              className={`w-20 ${inputClass}`}
              aria-label="Highest level (Gy)"
            />
            Gy
            <button type="button" className={buttonClass} disabled={!customRange} onClick={() => onSettingsChange({ rangeMin: null, rangeMax: null, customGy: null })}>
              Auto
            </button>
          </label>
        )}
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" className="accent-sky-600" checked={settings.smooth} onChange={(e) => onSettingsChange({ smooth: e.target.checked })} />
          Smooth
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" className="accent-sky-600" checked={overlayOnMap} onChange={(e) => onOverlayOnMapChange(e.target.checked)} />
          Overlay on dose map
        </label>
        {levels?.custom && (
          <button type="button" className={buttonClass} onClick={() => onSettingsChange({ [customKey]: null } as Partial<ContourSettings>)} title="Back to generated level values">
            Reset edited levels
          </button>
        )}
      </div>

      {message && <p className="text-sm text-slate-500 py-3">{message}</p>}

      {plot && crop && levels && levels.levels.length > 0 && (
        <>
          <div className="h-96">
            <Plot
              data={plot.data}
              layout={{
                ...PLOT_LIGHT_LAYOUT,
                annotations: plot.annotations,
                xaxis: { ...PLOT_LIGHT_AXIS, title: { text: "mm" }, constrain: "domain" },
                yaxis: {
                  ...PLOT_LIGHT_AXIS,
                  title: { text: "mm" },
                  autorange: "reversed",
                  scaleanchor: "x",
                  scaleratio: 1,
                },
              }}
              config={PLOT_CONFIG}
              useResizeHandler
              style={{ width: "100%", height: "100%" }}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5">
            {bandColors.map((color, k) => {
              const empty = plot.bandCounts[k] === 0;
              return (
                <span key={k} className={`inline-flex items-center gap-1.5 text-xs text-slate-700 ${empty ? "opacity-40" : ""}`} title={empty ? "No ROI pixels fall in this band" : undefined}>
                  <span className="inline-block w-3 h-3 rounded-sm border border-slate-300" style={{ backgroundColor: color }} />
                  {levels.bandLabels[k]}
                </span>
              );
            })}
          </div>
          <Caption>
            Levels: {levels.labels.join(", ")}
            {levels.custom ? " (edited by the author)" : ""}.{" "}
            {insideCount < levels.levels.length
              ? `${insideCount} of ${levels.levels.length} levels fall inside the ROI dose range (${fmt(crop.roiMin, 2)}–${fmt(crop.roiMax, 2)} Gy); the others draw no line and their bands are dimmed. `
              : ""}
            {percent
              ? `Levels are % of the ROI maximum (${fmt(refMax, 2)} Gy). `
              : customRange
                ? `Generated levels run evenly from ${fmt(settings.rangeMin ?? crop.roiMin, 2)} to ${fmt(settings.rangeMax ?? crop.roiMax, 2)} Gy. `
                : "Generated levels are spread evenly inside the ROI dose range. "}
            Hover a cell for its dose.
            {crop.step > 1 ? ` Display averaged over ${crop.step} × ${crop.step} px blocks.` : ""}
            {settings.smooth ? " Smooth applies a 3 × 3 average before contouring." : ""}
          </Caption>
        </>
      )}
    </Section>
  );
}
