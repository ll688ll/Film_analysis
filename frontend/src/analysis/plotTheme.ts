/**
 * Plotly styling shared by the ROI panel charts: the dark theme the image
 * page's histogram established (`imaging/IntensityHistogram.tsx`).
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
