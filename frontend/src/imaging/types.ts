/** Shared types for the general image-analysis page. */

export type IntensitySource = "Gray" | "Mean" | "Red" | "Green" | "Blue";

export const INTENSITY_SOURCES: IntensitySource[] = [
  "Gray",
  "Mean",
  "Red",
  "Green",
  "Blue",
];

export type BinningMethod =
  | "equal_width"
  | "equal_count"
  | "otsu"
  | "kmeans"
  | "manual";

export const BINNING_METHOD_LABELS: Record<BinningMethod, string> = {
  equal_width: "Equal width",
  equal_count: "Equal count",
  otsu: "Otsu",
  kmeans: "K-means",
  manual: "Manual",
};

export interface OverallStats {
  mean: number | null;
  std: number | null;
  min: number | null;
  max: number | null;
  median: number | null;
  p1: number | null;
  p99: number | null;
}

/** The augmented histogram every client-side statistic is derived from. */
export interface Histogram {
  bins: number;
  bin_width: number;
  value_min: number;
  value_max: number;
  /** Full data range, ignoring any value window. */
  data_min: number;
  data_max: number;
  counts: number[];
  sums: number[];
  sumsqs: number[];
  /** Pixels actually analysed -- the denominator for every percentage. */
  total_count: number;
  total_pixels: number;
  excluded_nonfinite: number;
  excluded_low: number;
  excluded_high: number;
  overall: OverallStats;
}

export interface AnalyzeResponse extends Histogram {
  session_id: string;
  source: IntensitySource;
  width: number;
  height: number;
  channels: number;
  dtype: string;
  max_possible: number | null;
  dpi: number;
  has_dpi: boolean;
  has_alpha: boolean;
}

export interface ImageMeta {
  session_id: string;
  filename: string;
  width: number;
  height: number;
  dpi: number;
  /** False when dpi is the 72.0 fallback -- physical units must be hidden. */
  has_dpi: boolean;
  channels: number;
  mode: string;
  original_mode: string;
  dtype: string;
  max_possible: number | null;
  has_alpha: boolean;
  n_frames: number;
}

/**
 * One intensity level.
 *
 * Bin indices are canonical and values are derived, which snaps every
 * boundary to a bin edge -- the condition that makes the prefix-sum
 * derivation in `intensityStats.ts` exact.
 */
export interface Level {
  index: number;
  loBin: number;
  hiBin: number;
  color: string;
  label: string;
  visible: boolean;
  /** Survives a binning-method change. */
  locked: boolean;
  /** True once the user picks a colour, so presets can preserve it. */
  customColor?: boolean;
}

export interface LevelStat {
  index: number;
  loBin: number;
  hiBin: number;
  lower: number;
  upper: number;
  count: number;
  countPct: number;
  mean: number | null;
  std: number | null;
  /** Bracketing bounds from the first/last non-empty bin, not exact values. */
  minApprox: number | null;
  maxApprox: number | null;
  /** Filled in by the "Exact" server round-trip. */
  exact?: { mean: number | null; std: number | null; min: number | null; max: number | null };
}

export interface ThresholdsResponse {
  method: BinningMethod;
  levels: number;
  requested_levels: number;
  edge_bins: number[];
  bound_bins: number[];
  edges: number[];
  bins: number;
  value_min: number;
  value_max: number;
  bin_width: number;
}

export interface ROIRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
