/**
 * Plotly styling shared by the ROI charts. The panel uses the dark theme the
 * image page's histogram established (`imaging/IntensityHistogram.tsx`); the
 * standalone report renders the same figures on a light page, so every colour
 * a figure needs comes from a palette rather than being written inline.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const PLOT_MARGIN = { l: 44, r: 8, t: 6, b: 30 };

export const PLOT_BASE_LAYOUT: any = {
  margin: PLOT_MARGIN,
  autosize: true,
  paper_bgcolor: "transparent",
  plot_bgcolor: "rgba(15,23,42,0.4)",
  font: { color: "#94a3b8", size: 9 },
  showlegend: false,
};

export const PLOT_AXIS: any = { gridcolor: "#334155", zeroline: false };

export const PLOT_CONFIG: any = { responsive: true, displayModeBar: false };

/** Light counterparts for the report page. */
export const PLOT_LIGHT_LAYOUT: any = {
  margin: { l: 48, r: 12, t: 8, b: 36 },
  autosize: true,
  paper_bgcolor: "transparent",
  plot_bgcolor: "#f8fafc",
  font: { color: "#475569", size: 10 },
  showlegend: false,
};

export const PLOT_LIGHT_AXIS: any = { gridcolor: "#e2e8f0", zeroline: false };

/** Every colour the ROI figures draw with, so one figure can serve both themes. */
export interface PlotPalette {
  /** Histogram bars inside / outside the trim cutoffs. */
  kept: string;
  trimmed: string;
  meanLine: string;
  medianLine: string;
  trimLine: string;
  trimFill: string;
  /** Isolines: a halo under the line, and the label chip. */
  isolineHalo: string;
  isolineStroke: string;
  labelFont: string;
  labelBg: string;
  /** Profiles. */
  profileLine: string;
  extentFill: string;
  guideLine: string;
  crossing50: string;
  otherProfile: string;
}

export const DARK_PALETTE: PlotPalette = {
  kept: "#38bdf8",
  trimmed: "#475569",
  meanLine: "#f8fafc",
  medianLine: "#facc15",
  trimLine: "#fb7185",
  trimFill: "rgba(251,113,133,0.12)",
  isolineHalo: "#0f172a",
  isolineStroke: "#ffffff",
  labelFont: "#ffffff",
  labelBg: "rgba(15,23,42,0.7)",
  profileLine: "#38bdf8",
  extentFill: "rgba(34,211,238,0.10)",
  guideLine: "#94a3b8",
  crossing50: "#facc15",
  otherProfile: "#f8fafc",
};

export const LIGHT_PALETTE: PlotPalette = {
  kept: "#0284c7",
  trimmed: "#cbd5e1",
  meanLine: "#0f172a",
  medianLine: "#ca8a04",
  trimLine: "#e11d48",
  trimFill: "rgba(225,29,72,0.10)",
  isolineHalo: "#ffffff",
  isolineStroke: "#0f172a",
  labelFont: "#0f172a",
  labelBg: "rgba(255,255,255,0.85)",
  profileLine: "#0284c7",
  extentFill: "rgba(2,132,199,0.08)",
  guideLine: "#94a3b8",
  crossing50: "#ca8a04",
  otherProfile: "#334155",
};

/** Plotly line-shape helper. */
export function verticalLine(x: number, color: string, dash?: string): any {
  return {
    type: "line",
    x0: x,
    x1: x,
    y0: 0,
    y1: 1,
    yref: "paper",
    line: { color, width: 1.5, dash },
  };
}
