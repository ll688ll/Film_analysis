import { useMemo, useState } from "react";
import Plot from "react-plotly.js";
import { sampleColormap, type ColormapName } from "./colormaps";
import { MAX_LEVELS, MIN_LEVELS, clampLevelCount, type ContourLevels } from "./contourLevels";
import { fmt } from "./format";
import { bandIndexGrid, contourField, doseGrid } from "./isolines";
import { PLOT_AXIS, PLOT_BASE_LAYOUT, PLOT_CONFIG } from "./plotTheme";
import type { RoiCrop } from "./roiCrop";
import { pxToMm } from "./roiGeometry";
import type { ContourSettings, Isoline } from "./roiTypes";

interface RoiContourProps {
  crop: RoiCrop | null;
  levels: ContourLevels | null;
  isolines: Isoline[] | null;
  colormap: ColormapName;
  dpi: number;
  refMax: number | null;
  hasRoi: boolean;
  settings: ContourSettings;
  onSettingsChange: (patch: Partial<ContourSettings>) => void;
}

const segBtn = (active: boolean) =>
  `flex-1 px-2 py-1.5 text-xs font-medium transition-colors ${
    active ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-600"
  }`;

const smallBtn =
  "px-2 py-1 text-xs font-medium rounded border bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-600 disabled:opacity-50 disabled:hover:bg-slate-800 transition-colors";

const numberInput =
  "px-2 py-1 text-xs bg-slate-800 border border-slate-600 rounded text-slate-200 text-right placeholder-slate-500";

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 text-xs text-slate-300"
    >
      <span
        className={`relative inline-block w-[30px] h-4 rounded-full transition-colors ${
          checked ? "bg-sky-500" : "bg-slate-500"
        }`}
      >
        <span
          className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${
            checked ? "left-4" : "left-0.5"
          }`}
        />
      </span>
      {label}
    </button>
  );
}

/** Isodose map of the ROI: stepped bands from the active colormap plus labelled isolines. */
export default function RoiContour({
  crop,
  levels,
  isolines,
  colormap,
  dpi,
  refMax,
  hasRoi,
  settings,
  onSettingsChange,
}: RoiContourProps) {
  const n = levels?.levels.length ?? 0;
  const percent = settings.mode === "percent";
  const customKey = percent ? "customPercent" : "customGy";
  // Text being typed into a level box, so partial input ("1.") is not
  // committed as a number until it parses.
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  const bandColors = useMemo(
    () => sampleColormap(colormap, n + 1, "center"),
    [colormap, n]
  );

  const plot = useMemo(() => {
    if (!crop || !levels) return null;
    const field = contourField(crop, settings.smooth);
    const stepped: Array<[number, string]> = [];
    bandColors.forEach((color, k) => {
      stepped.push([k / (n + 1), color], [(k + 1) / (n + 1), color]);
    });

    const bands = bandIndexGrid(field, levels.levels);
    const bandCounts = new Array<number>(n + 1).fill(0);
    for (const row of bands) for (const k of row) if (k !== null) bandCounts[k]++;

    const xs: (number | null)[] = [];
    const ys: (number | null)[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const annotations: any[] = [];
    (isolines ?? []).forEach((iso, i) => {
      let longest: number[] = [];
      for (const path of iso.paths) {
        if (path.length > longest.length) longest = path;
        for (let j = 0; j < path.length; j += 2) {
          xs.push(pxToMm(path[j], dpi));
          ys.push(pxToMm(path[j + 1], dpi));
        }
        xs.push(null);
        ys.push(null);
      }
      const points = longest.length / 2;
      if (points > 0) {
        // Spread the labels around the nested contours rather than piling them up
        const p = Math.floor(points * ((i + 0.5) / Math.max(1, n))) % points;
        annotations.push({
          x: pxToMm(longest[2 * p], dpi),
          y: pxToMm(longest[2 * p + 1], dpi),
          text: iso.label,
          showarrow: false,
          font: { size: 9, color: "#ffffff" },
          bgcolor: "rgba(15,23,42,0.7)",
          borderpad: 1,
        });
      }
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any[] = [
      {
        type: "heatmap",
        x: crop.xMm,
        y: crop.yMm,
        z: bands,
        zmin: -0.5,
        zmax: n + 0.5,
        colorscale: stepped,
        showscale: false,
        customdata: doseGrid(field),
        hovertemplate: "%{customdata:.3f} Gy<extra></extra>",
        hoverongaps: false,
      },
      {
        type: "scatter",
        mode: "lines",
        x: xs,
        y: ys,
        line: { color: "#0f172a", width: 3 },
        opacity: 0.6,
        hoverinfo: "skip",
        connectgaps: false,
      },
      {
        type: "scatter",
        mode: "lines",
        x: xs,
        y: ys,
        line: { color: "#ffffff", width: 1.2 },
        hoverinfo: "skip",
        connectgaps: false,
      },
    ];
    return { data, annotations, bandCounts };
  }, [crop, levels, isolines, bandColors, n, dpi, settings.smooth]);

  const insideCount =
    crop && levels
      ? levels.levels.filter((L) => L > crop.roiMin && L < crop.roiMax).length
      : 0;

  const customRange = settings.rangeMin != null || settings.rangeMax != null;
  const badRange =
    !percent &&
    settings.rangeMin != null &&
    settings.rangeMax != null &&
    !(settings.rangeMax > settings.rangeMin);
  const message = !hasRoi
    ? "Draw an ROI on the dose map to see its isodose map."
    : !crop
      ? "No ROI pixels to contour — check the threshold and ROI position."
      : badRange
        ? "The range maximum must be above its minimum."
        : levels && levels.levels.length === 0
          ? "No contour levels yet — set a range or level values."
          : null;

  const setLevelValue = (index: number, text: string) => {
    if (!levels) return;
    setDrafts((d) => ({ ...d, [index]: text }));
    const value = Number(text);
    if (text.trim() === "" || !Number.isFinite(value)) return;
    const next = [...levels.values];
    next[index] = value;
    onSettingsChange({ [customKey]: next } as Partial<ContourSettings>);
  };

  const levelUnit = percent ? "% of max" : "Gy";

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1 flex rounded-md overflow-hidden border border-slate-600">
          <button
            type="button"
            onClick={() => onSettingsChange({ mode: "percent" })}
            className={segBtn(percent)}
            title="Levels as a percentage of the ROI maximum"
          >
            % of max
          </button>
          <button
            type="button"
            onClick={() => onSettingsChange({ mode: "absolute" })}
            className={segBtn(!percent)}
            title="Levels in Gy"
          >
            Gy
          </button>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-400">
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
            title="How many levels to generate; editing a value below keeps your own list"
            className={`w-12 ${numberInput}`}
          />
        </label>
      </div>

      {!percent && (
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-slate-400">Range</span>
          <input
            type="number"
            step={0.1}
            value={settings.rangeMin ?? ""}
            placeholder={crop ? crop.roiMin.toFixed(2) : "min"}
            onChange={(e) =>
              onSettingsChange({
                rangeMin: e.target.value === "" ? null : Number(e.target.value),
                customGy: null,
              })
            }
            title="Lowest level in Gy; leave empty to follow the ROI minimum"
            className={`w-[4.5rem] ${numberInput}`}
          />
          <span className="text-xs text-slate-500">–</span>
          <input
            type="number"
            step={0.1}
            value={settings.rangeMax ?? ""}
            placeholder={crop ? crop.roiMax.toFixed(2) : "max"}
            onChange={(e) =>
              onSettingsChange({
                rangeMax: e.target.value === "" ? null : Number(e.target.value),
                customGy: null,
              })
            }
            title="Highest level in Gy; leave empty to follow the ROI maximum"
            className={`w-[4.5rem] ${numberInput}`}
          />
          <span className="text-xs text-slate-500">Gy</span>
          <button
            type="button"
            onClick={() =>
              onSettingsChange({ rangeMin: null, rangeMax: null, customGy: null })
            }
            disabled={!customRange}
            title="Follow the ROI dose range again"
            className={`ml-auto ${smallBtn}`}
          >
            Auto
          </button>
        </div>
      )}

      {levels && levels.values.length > 0 && (
        <div className="mb-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-slate-400">
              Level values ({levelUnit})
              {levels.custom && <span className="text-sky-400"> · edited</span>}
            </span>
            <button
              type="button"
              onClick={() => {
                setDrafts({});
                onSettingsChange({ [customKey]: null } as Partial<ContourSettings>);
              }}
              disabled={!levels.custom}
              title="Back to the generated values"
              className={smallBtn}
            >
              Reset
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {levels.values.map((v, i) => (
              <input
                key={i}
                type="number"
                step={percent ? 1 : 0.1}
                value={drafts[i] ?? (percent ? String(+v.toFixed(1)) : v.toFixed(2))}
                onChange={(e) => setLevelValue(i, e.target.value)}
                onBlur={() =>
                  setDrafts((d) => {
                    const { [i]: _dropped, ...rest } = d;
                    return rest;
                  })
                }
                aria-label={`Level ${i + 1} (${levelUnit})`}
                className={`w-[4.25rem] px-1.5 py-0.5 text-[11px] font-mono ${numberInput}`}
              />
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-2">
        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.smooth}
            onChange={(e) => onSettingsChange({ smooth: e.target.checked })}
            className="accent-sky-500"
          />
          Smooth
        </label>
        <Switch
          checked={settings.overlay}
          onChange={(v) => onSettingsChange({ overlay: v })}
          label="Overlay on map"
        />
      </div>

      {message && <p className="text-sm text-slate-500 py-4">{message}</p>}

      {plot && crop && levels && levels.levels.length > 0 && (
        <>
          <div className="h-72">
            <Plot
              data={plot.data}
              layout={{
                ...PLOT_BASE_LAYOUT,
                annotations: plot.annotations,
                xaxis: { ...PLOT_AXIS, title: { text: "mm" }, constrain: "domain" },
                yaxis: {
                  ...PLOT_AXIS,
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
                <span
                  key={k}
                  title={empty ? "No ROI pixels fall in this band" : undefined}
                  className={`inline-flex items-center gap-1.5 text-[11px] text-slate-300 ${
                    empty ? "opacity-40" : ""
                  }`}
                >
                  <span
                    className="inline-block w-3 h-3 rounded-sm border border-white/15"
                    style={{ backgroundColor: color }}
                  />
                  {levels.bandLabels[k]}
                </span>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {insideCount < levels.levels.length
              ? `${insideCount} of ${levels.levels.length} levels fall inside the ROI dose range (${fmt(crop.roiMin, 2)}–${fmt(crop.roiMax, 2)} Gy); the others draw no line and their bands are dimmed. `
              : ""}
            {percent
              ? `Levels are % of the ROI max (${fmt(refMax, 2)} Gy). `
              : customRange
                ? `Generated levels run evenly from ${fmt(settings.rangeMin ?? crop.roiMin, 2)} to ${fmt(settings.rangeMax ?? crop.roiMax, 2)} Gy. `
                : `Generated levels are spread evenly inside the ROI dose range. `}
            Edit any level value above to set the sections yourself. Hover a cell for its dose.
            {crop.step > 1 ? ` Display averaged over ${crop.step}×${crop.step} px blocks.` : ""}
            {settings.smooth ? " Smooth applies a 3×3 average before contouring." : ""}
          </p>
        </>
      )}
    </div>
  );
}
