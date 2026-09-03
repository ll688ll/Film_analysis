/**
 * Shared ROI types for the film dose page.
 *
 * Geometry convention, matching `build_roi_mask` on the backend: `x, y, w, h`
 * is the bounding box *before* rotation, in image pixels, and `rotation`
 * (degrees, clockwise on screen) is applied about the box centre
 * `(x + w/2, y + h/2)`. Circle and Ring ROIs share the box: the centre is the
 * box centre and the radii are `w/2` and `h/2`.
 */

export type ROIType = "Rectangle" | "Circle" | "Ring";

export interface ROIData {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

/** Everything the ROI Tools section edits; AnalysisPage owns each field. */
export interface RoiSettings {
  roiType: ROIType;
  rotation: number;
  holeRatio: number;
  threshold: number;
  trimEnabled: boolean;
  trimPercent: number;
  cornerCutEnabled: boolean;
  cornerCutMm: number;
}

/** The options that decide which pixels of the box belong to the ROI. */
export interface RoiMaskOptions {
  roiType: ROIType;
  /** Ring only: inner radius as a percentage of the outer radius. */
  holeRatio: number;
  /** Gy. When > 0, pixels at or below this dose are excluded. */
  threshold: number;
  /** Rectangle only: 45° chamfer leg length in image pixels (0 = none). */
  cornerCutPx: number;
}

/** `histogram` field of `POST /analysis/{id}/roi`: all masked pixels, untrimmed. */
export interface RoiHistogramData {
  bins: number;
  value_min: number;
  value_max: number;
  bin_width: number;
  counts: number[];
  total_count: number;
}

/** Response of `POST /analysis/{id}/roi`. Ratios are null when undefined (e.g. min = 0). */
export interface ROIStats {
  max: number;
  min: number;
  mean: number;
  std: number;
  cv: number | null;
  dur: number | null;
  flatness: number | null;
  median?: number;
  p2?: number;
  p98?: number;
  homogeneity_index?: number | null;
  pixel_count?: number;
  trimmed_count?: number;
  /** Dose of the lowest / highest kept pixel; null when nothing was trimmed. */
  trim_low?: number | null;
  trim_high?: number | null;
  histogram?: RoiHistogramData | null;
  center_x_mm: number;
  center_y_mm: number;
  width_mm: number;
  height_mm: number;
  area_mm2: number;
  trim_enabled?: boolean;
  trim_percent?: number;
  corner_cut_mm?: number;
  roi_type?: string;
  dpi?: number;
}

/** One isodose level: polylines as flat `[x0, y0, x1, y1, …]` in image pixels. */
export interface Isoline {
  level: number;
  label: string;
  paths: number[][];
}

export type RoiTab = "stats" | "histogram" | "contour" | "profiles";

/** How contour levels are chosen: relative to the ROI maximum, or in Gy. */
export type LevelMode = "percent" | "absolute";

/** Contour view settings, persisted with the panel preferences. */
export interface ContourSettings {
  mode: LevelMode;
  /** Number of isodose levels (2–10). */
  levels: number;
  /** Draw the isolines on the main dose map as well. */
  overlay: boolean;
  /** Round off the isolines when the crop is block-averaged. */
  smooth: boolean;
  /** Gy mode only: level range in Gy; null bounds follow the ROI dose range. */
  rangeMin: number | null;
  rangeMax: number | null;
  /** Hand-edited level values (% of max / Gy); null means generated from count and range. */
  customPercent: number[] | null;
  customGy: number[] | null;
}

/**
 * Where the profiles are taken, as offsets from the ROI centre along the
 * ROI's own width (u) and height (v) axes, in image pixels. The horizontal
 * profile runs along u at offset v; the vertical one along v at offset u.
 */
export interface ProfileOffset {
  u: number;
  v: number;
}
