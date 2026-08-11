import { useCallback, useMemo } from "react";
import Plot from "react-plotly.js";
import type { AnalyzeResponse, Level } from "./types";

export type HistogramMode = "levels" | "rgb";

interface IntensityHistogramProps {
  hist: AnalyzeResponse | null;
  levels: Level[];
  mode: HistogramMode;
  onModeChange: (m: HistogramMode) => void;
  /** Per-channel histograms, fetched lazily for the RGB view. */
  rgbHists: Record<"Red" | "Green" | "Blue", AnalyzeResponse | null> | null;
  rgbLoading: boolean;
  canShowRgb: boolean;
  /** Move interior boundary *i* (0-based) to a bin index. Switches to manual. */
  onBoundaryChange: (boundaryIndex: number, bin: number) => void;
}

/** Keep the chart readable regardless of the analysis bin count. */
const MAX_BARS = 256;

interface Downsampled {
  x: number[];
  y: number[];
  colors?: string[];
}

function downsample(
  hist: AnalyzeResponse,
  colorForBin?: (bin: number) => string
): Downsampled {
  const group = Math.max(1, Math.ceil(hist.bins / MAX_BARS));
  const x: number[] = [];
  const y: number[] = [];
  const colors: string[] = [];

  for (let start = 0; start < hist.bins; start += group) {
    const end = Math.min(hist.bins, start + group);
    let total = 0;
    for (let i = start; i < end; i++) total += hist.counts[i];
    const mid = start + (end - start) / 2;
    x.push(hist.value_min + mid * hist.bin_width);
    y.push(total);
    if (colorForBin) colors.push(colorForBin(start));
  }

  return colorForBin ? { x, y, colors } : { x, y };
}

export default function IntensityHistogram({
  hist,
  levels,
  mode,
  onModeChange,
  rgbHists,
  rgbLoading,
  canShowRgb,
  onBoundaryChange,
}: IntensityHistogramProps) {
  const levelTrace = useMemo(() => {
    if (!hist) return null;
    const colorForBin = (bin: number) => {
      for (const l of levels) {
        if (bin >= l.loBin && bin <= l.hiBin) {
          return l.visible ? l.color : "#475569";
        }
      }
      return "#64748b";
    };
    return downsample(hist, colorForBin);
  }, [hist, levels]);

  const boundaryShapes = useMemo(() => {
    if (!hist || mode !== "levels") return [];
    return levels.slice(1).map((l) => {
      const value = hist.value_min + l.loBin * hist.bin_width;
      return {
        type: "line" as const,
        x0: value,
        x1: value,
        y0: 0,
        y1: 1,
        yref: "paper" as const,
        line: { color: "#e2e8f0", width: 1.5, dash: "dot" as const },
        editable: true,
      };
    });
  }, [hist, levels, mode]);

  /**
   * Plotly reports a dragged shape as `shapes[i].x0` / `.x1` in a relayout
   * event. Boundary shapes are emitted in level order, so the shape index is
   * the interior-boundary index.
   */
  const handleRelayout = useCallback(
    (event: Record<string, unknown>) => {
      if (!hist || mode !== "levels") return;
      for (const [key, value] of Object.entries(event)) {
        const match = /^shapes\[(\d+)\]\.x0$/.exec(key);
        if (!match || typeof value !== "number") continue;
        const bin = Math.round((value - hist.value_min) / hist.bin_width);
        onBoundaryChange(Number(match[1]), bin);
      }
    },
    [hist, mode, onBoundaryChange]
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const traces: any[] = [];

  if (mode === "levels" && levelTrace) {
    traces.push({
      x: levelTrace.x,
      y: levelTrace.y,
      type: "bar",
      name: hist?.source ?? "Intensity",
      marker: { color: levelTrace.colors },
      hovertemplate: "%{x:.1f}: %{y:,} px<extra></extra>",
    });
  } else if (mode === "rgb" && rgbHists) {
    const channels: Array<["Red" | "Green" | "Blue", string]> = [
      ["Red", "#ef4444"],
      ["Green", "#22c55e"],
      ["Blue", "#3b82f6"],
    ];
    for (const [name, color] of channels) {
      const h = rgbHists[name];
      if (!h) continue;
      const d = downsample(h);
      traces.push({
        x: d.x,
        y: d.y,
        type: "scatter",
        mode: "lines",
        name,
        line: { color, width: 1.5 },
        fill: "tozeroy",
        fillcolor: `${color}22`,
        hovertemplate: `${name} %{x:.0f}: %{y:,} px<extra></extra>`,
      });
    }
  }

  const tabBtn = (active: boolean, isDisabled = false) =>
    `px-2 py-1 text-xs font-medium rounded transition-colors ${
      isDisabled
        ? "text-slate-600 cursor-not-allowed"
        : active
        ? "bg-sky-600 text-white"
        : "bg-slate-800 text-slate-300 hover:bg-slate-600"
    }`;

  return (
    <div className="p-4 border-b border-slate-600">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Histogram
        </h2>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => onModeChange("levels")}
            className={tabBtn(mode === "levels")}
          >
            Levels
          </button>
          <button
            type="button"
            disabled={!canShowRgb}
            title={canShowRgb ? undefined : "Image has no colour channels"}
            onClick={() => onModeChange("rgb")}
            className={tabBtn(mode === "rgb", !canShowRgb)}
          >
            RGB
          </button>
        </div>
      </div>

      {!hist && <p className="text-sm text-slate-500">No image loaded.</p>}

      {hist && mode === "rgb" && rgbLoading && (
        <p className="text-xs text-slate-500 py-8 text-center">
          Loading channel histograms…
        </p>
      )}

      {hist && !(mode === "rgb" && rgbLoading) && (
        <div className="h-48">
          <Plot
            data={traces}
            layout={{
              margin: { l: 44, r: 8, t: 6, b: 30 },
              autosize: true,
              bargap: 0,
              showlegend: mode === "rgb",
              legend: { x: 1, xanchor: "right", y: 1, font: { size: 9 } },
              paper_bgcolor: "transparent",
              plot_bgcolor: "rgba(15,23,42,0.4)",
              font: { color: "#94a3b8", size: 9 },
              shapes: boundaryShapes,
              xaxis: { gridcolor: "#334155", zeroline: false },
              yaxis: { gridcolor: "#334155", zeroline: false, title: { text: "px" } },
            }}
            config={{
              responsive: true,
              displayModeBar: false,
              // Only shape positions are editable -- not titles or legends.
              edits: { shapePosition: true },
            }}
            onRelayout={handleRelayout}
            useResizeHandler
            style={{ width: "100%", height: "100%" }}
          />
        </div>
      )}

      {hist && mode === "levels" && levels.length > 1 && (
        <p className="mt-2 text-xs text-slate-500">
          Drag a dotted boundary to adjust a level. Edits snap to bin edges.
        </p>
      )}
    </div>
  );
}
