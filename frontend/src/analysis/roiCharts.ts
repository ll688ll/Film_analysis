/**
 * Plotly figures for the ROI views, as pure functions of the data and a
 * palette. The panel draws them dark; the standalone report draws the very
 * same figures light, so what a reader sees in a report is what the analyst
 * saw on screen.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { ContourLevels } from "./contourLevels";
import { bandIndexGrid, contourField, doseGrid } from "./isolines";
import type { PlotPalette } from "./plotTheme";
import { verticalLine } from "./plotTheme";
import type { DoseProfile, ProfileMetrics } from "./profileMetrics";
import type { RoiCrop } from "./roiCrop";
import { pxToMm } from "./roiGeometry";
import type { Isoline, ROIStats } from "./roiTypes";

export interface HistogramFigure {
  data: any[];
  shapes: any[];
}

/** Bars at bin centres, grey outside the trim cutoffs, with mean / median / cutoff markers. */
export function histogramFigure(stats: ROIStats, palette: PlotPalette): HistogramFigure | null {
  const hist = stats.histogram;
  if (!hist) return null;
  const lo = stats.trim_low ?? -Infinity;
  const hi = stats.trim_high ?? Infinity;
  const centers: number[] = [];
  const colors: string[] = [];
  for (let i = 0; i < hist.counts.length; i++) {
    const c = hist.value_min + (i + 0.5) * hist.bin_width;
    centers.push(c);
    colors.push(c >= lo && c <= hi ? palette.kept : palette.trimmed);
  }
  const data: any[] = [
    {
      type: "bar",
      x: centers,
      y: hist.counts,
      width: hist.bin_width,
      marker: { color: colors },
      hovertemplate: "%{x:.3f} Gy: %{y:,} px<extra></extra>",
    },
  ];
  const shapes: any[] = [verticalLine(stats.mean, palette.meanLine)];
  if (stats.median != null) shapes.push(verticalLine(stats.median, palette.medianLine, "dash"));
  if (stats.trim_low != null && stats.trim_high != null) {
    const tail = (x0: number, x1: number) => ({
      type: "rect",
      x0,
      x1,
      y0: 0,
      y1: 1,
      yref: "paper",
      fillcolor: palette.trimFill,
      line: { width: 0 },
      layer: "below",
    });
    shapes.push(
      tail(hist.value_min, stats.trim_low),
      tail(stats.trim_high, hist.value_max),
      verticalLine(stats.trim_low, palette.trimLine, "dot"),
      verticalLine(stats.trim_high, palette.trimLine, "dot")
    );
  }
  return { data, shapes };
}

export interface ContourFigure {
  data: any[];
  annotations: any[];
  /** ROI cells per band, for dimming empty legend entries. */
  bandCounts: number[];
}

/**
 * Stepped heatmap of band indices in the band colours, the isolines as two
 * scatter traces (halo under line), and one label per level.
 */
export function contourFigure(
  crop: RoiCrop,
  levels: ContourLevels,
  isolines: Isoline[] | null,
  bandColors: string[],
  dpi: number,
  smooth: boolean,
  palette: PlotPalette
): ContourFigure {
  const n = levels.levels.length;
  const field = contourField(crop, smooth);
  const stepped: Array<[number, string]> = [];
  bandColors.forEach((color, k) => {
    stepped.push([k / (n + 1), color], [(k + 1) / (n + 1), color]);
  });

  const bands = bandIndexGrid(field, levels.levels);
  const bandCounts = new Array<number>(n + 1).fill(0);
  for (const row of bands) for (const k of row) if (k !== null) bandCounts[k]++;

  const xs: (number | null)[] = [];
  const ys: (number | null)[] = [];
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
        font: { size: 9, color: palette.labelFont },
        bgcolor: palette.labelBg,
        borderpad: 1,
      });
    }
  });

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
      line: { color: palette.isolineHalo, width: 3 },
      opacity: 0.6,
      hoverinfo: "skip",
      connectgaps: false,
    },
    {
      type: "scatter",
      mode: "lines",
      x: xs,
      y: ys,
      line: { color: palette.isolineStroke, width: 1.2 },
      hoverinfo: "skip",
      connectgaps: false,
    },
  ];
  return { data, annotations, bandCounts };
}

export interface ProfileFigure {
  data: any[];
  shapes: any[];
}

/** One profile with the ROI extent shaded, 80 / 50 / 20 % guides and the 50 % crossings. */
export function profileFigure(
  profile: DoseProfile,
  metrics: ProfileMetrics,
  palette: PlotPalette
): ProfileFigure {
  const data: any[] = [
    {
      type: "scatter",
      mode: "lines",
      x: profile.positionMm,
      y: profile.dose,
      line: { color: palette.profileLine, width: 1.5 },
      hovertemplate: "%{x:.2f} mm: %{y:.3f} Gy<extra></extra>",
    },
  ];
  const shapes: any[] = [
    {
      type: "rect",
      x0: -profile.halfExtentMm,
      x1: profile.halfExtentMm,
      y0: 0,
      y1: 1,
      yref: "paper",
      fillcolor: palette.extentFill,
      line: { width: 0 },
      layer: "below",
    },
  ];
  if (metrics.maxDose != null) {
    for (const frac of [0.8, 0.5, 0.2]) {
      shapes.push({
        type: "line",
        xref: "paper",
        x0: 0,
        x1: 1,
        y0: frac * metrics.maxDose,
        y1: frac * metrics.maxDose,
        line: { color: palette.guideLine, width: 1, dash: "dot" },
      });
    }
  }
  if (metrics.left50Mm != null) shapes.push(verticalLine(metrics.left50Mm, palette.crossing50));
  if (metrics.right50Mm != null) shapes.push(verticalLine(metrics.right50Mm, palette.crossing50));
  // Where the other crosshair line crosses this profile
  shapes.push(verticalLine(profile.crossMm, palette.otherProfile, "dot"));
  return { data, shapes };
}
