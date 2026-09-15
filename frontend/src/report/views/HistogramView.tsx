import { useMemo } from "react";
import Plot from "../../components/Plot";
import { fmt, thousands } from "../../analysis/format";
import { LIGHT_PALETTE, PLOT_CONFIG, PLOT_LIGHT_AXIS, PLOT_LIGHT_LAYOUT } from "../../analysis/plotTheme";
import { histogramFigure } from "../../analysis/roiCharts";
import { downloadCsvFile, histogramToCSV, type ExportMeta } from "../../analysis/roiExport";
import type { ROIStats } from "../../analysis/roiTypes";
import { buttonClass, Caption, IconDownload, LineSwatch, Section } from "../ui";

const palette = LIGHT_PALETTE;

interface HistogramViewProps {
  stats: ROIStats;
  exportMeta: ExportMeta;
  filmName: string | null;
}

/** Dose histogram of every ROI pixel with the statistics' markers, as in the panel. */
export default function HistogramView({ stats, exportMeta, filmName }: HistogramViewProps) {
  const hist = stats.histogram ?? null;
  const figure = useMemo(() => histogramFigure(stats, palette), [stats]);
  const trimmed = stats.trim_low != null && stats.trim_high != null;

  if (!hist || !figure) {
    return (
      <Section id="histogram" title="Dose histogram">
        <p className="text-sm text-slate-500">The histogram was not part of the saved statistics.</p>
      </Section>
    );
  }

  return (
    <Section
      id="histogram"
      title="Dose histogram"
      actions={
        <button
          type="button"
          className={buttonClass}
          onClick={() => downloadCsvFile(histogramToCSV(hist, exportMeta), filmName, "roi_histogram")}
          title="Download the bin counts as CSV"
        >
          <IconDownload />
          CSV
        </button>
      }
    >
      <div className="h-64">
        <Plot
          data={figure.data}
          layout={{
            ...PLOT_LIGHT_LAYOUT,
            bargap: 0.05,
            shapes: figure.shapes,
            xaxis: { ...PLOT_LIGHT_AXIS, title: { text: "Dose (Gy)" } },
            yaxis: { ...PLOT_LIGHT_AXIS, title: { text: "px" } },
          }}
          config={PLOT_CONFIG}
          useResizeHandler
          style={{ width: "100%", height: "100%" }}
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-700">
        <span className="inline-flex items-center gap-1.5">
          <LineSwatch color={palette.meanLine} />
          Mean {fmt(stats.mean)} Gy
        </span>
        <span className="inline-flex items-center gap-1.5">
          <LineSwatch color={palette.medianLine} dash="4 3" />
          Median {fmt(stats.median)} Gy
        </span>
        {trimmed && (
          <span className="inline-flex items-center gap-1.5">
            <LineSwatch color={palette.trimLine} dash="2 3" />
            Trim {fmt(stats.trim_percent, 1)} % per tail: {fmt(stats.trim_low, 2)}–{fmt(stats.trim_high, 2)} Gy
          </span>
        )}
      </div>
      <Caption>
        {hist.bins} bins over {fmt(hist.value_min, 2)}–{fmt(hist.value_max, 2)} Gy.{" "}
        {trimmed
          ? `The histogram uses all ${thousands(hist.total_count)} px in the ROI; the statistics use the ${thousands(stats.trimmed_count)} kept after trimming (grey bars were excluded).`
          : `Histogram and statistics use all ${thousands(hist.total_count)} px in the ROI.`}{" "}
        Hover a bar for its count; drag to zoom, double-click to reset.
      </Caption>
    </Section>
  );
}
