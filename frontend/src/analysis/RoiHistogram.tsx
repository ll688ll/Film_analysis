import { useMemo } from "react";
import Plot from "../components/Plot";
import { fmt, thousands } from "./format";
import { IconDownload, toolbarButtonClass } from "./panelIcons";
import { DARK_PALETTE, PLOT_AXIS, PLOT_BASE_LAYOUT, PLOT_CONFIG } from "./plotTheme";
import { histogramFigure } from "./roiCharts";
import { downloadCsvFile, histogramToCSV, type ExportMeta } from "./roiExport";
import type { ROIStats } from "./roiTypes";

interface RoiHistogramProps {
  stats: ROIStats | null;
  loading: boolean;
  exportMeta: ExportMeta;
  filmName: string | null;
}

const palette = DARK_PALETTE;

function LineSwatch({ color, dash }: { color: string; dash?: string }) {
  return (
    <svg width="18" height="8" viewBox="0 0 18 8" aria-hidden="true">
      <line x1="1" x2="17" y1="4" y2="4" stroke={color} strokeWidth="2" strokeDasharray={dash} />
    </svg>
  );
}

/** Dose histogram of every ROI pixel, with the statistics' markers. */
export default function RoiHistogram({
  stats,
  loading,
  exportMeta,
  filmName,
}: RoiHistogramProps) {
  const hist = stats?.histogram ?? null;
  const trimmed = stats != null && stats.trim_low != null && stats.trim_high != null;

  const figure = useMemo(() => (stats ? histogramFigure(stats, palette) : null), [stats]);
  const data = figure?.data ?? [];
  const shapes = figure?.shapes ?? [];

  const handleDownload = () => {
    if (!hist) return;
    downloadCsvFile(histogramToCSV(hist, exportMeta), filmName, "roi_histogram");
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs text-slate-500 truncate">
          {hist ? `${hist.bins} bins · ${thousands(hist.total_count)} px` : ""}
        </span>
        <button
          type="button"
          onClick={handleDownload}
          disabled={!hist}
          title="Download the bin counts as CSV"
          className={toolbarButtonClass}
        >
          <IconDownload size={14} />
          CSV
        </button>
      </div>

      {!hist && (
        <p className="text-sm text-slate-500">
          {loading
            ? "Computing..."
            : "Draw an ROI on the dose map to see its dose histogram."}
        </p>
      )}

      {hist && stats && (
        <>
          <div className={`h-48 transition-opacity ${loading ? "opacity-50" : ""}`}>
            <Plot
              data={data}
              layout={{
                ...PLOT_BASE_LAYOUT,
                bargap: 0.05,
                shapes,
                xaxis: { ...PLOT_AXIS, title: { text: "Dose (Gy)" } },
                yaxis: { ...PLOT_AXIS, title: { text: "px" } },
              }}
              config={PLOT_CONFIG}
              useResizeHandler
              style={{ width: "100%", height: "100%" }}
            />
          </div>

          <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1.5 text-[11px] text-slate-300">
            <span className="inline-flex items-center gap-1.5">
              <LineSwatch color={palette.meanLine} />
              Mean {fmt(stats.mean)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <LineSwatch color={palette.medianLine} dash="4 3" />
              Median {fmt(stats.median)}
            </span>
            {trimmed && (
              <span className="inline-flex items-center gap-1.5">
                <LineSwatch color={palette.trimLine} dash="2 3" />
                Trim {fmt(stats.trim_percent, 1)}%: {fmt(stats.trim_low, 2)}–
                {fmt(stats.trim_high, 2)} Gy
              </span>
            )}
          </div>

          <p className="mt-2 text-xs text-slate-500">
            {trimmed
              ? `Histogram uses all ${thousands(hist.total_count)} px · statistics use the ${thousands(stats.trimmed_count)} kept after trimming.`
              : `Histogram and statistics use all ${thousands(hist.total_count)} px in the ROI.`}
          </p>
        </>
      )}
    </div>
  );
}
