import type { LevelMode } from "./roiTypes";

export const MIN_LEVELS = 2;
export const MAX_LEVELS = 10;

/** Isodose presets in % of the ROI maximum; beyond 8 the levels are evenly spaced. */
const PERCENT_PRESETS: Record<number, number[]> = {
  2: [50, 90],
  3: [50, 80, 95],
  4: [20, 50, 80, 95],
  5: [20, 50, 80, 90, 95],
  6: [10, 20, 50, 80, 90, 95],
  7: [10, 20, 50, 70, 80, 90, 95],
  8: [10, 20, 30, 50, 70, 80, 90, 95],
};

export interface LevelRange {
  min: number | null;
  max: number | null;
}

export interface ContourLevels {
  mode: LevelMode;
  /** Dose values (Gy), ascending and unique. Levels outside the ROI range draw no line. */
  levels: number[];
  labels: string[];
  /** Labels for the N + 1 bands between the levels, for a legend. */
  bandLabels: string[];
  /**
   * The level values in the mode's own unit (% of max, or Gy), in the order
   * they are shown for editing: a hand-edited list keeps its order, a
   * generated one is ascending.
   */
  values: number[];
  custom: boolean;
}

export function clampLevelCount(n: number): number {
  return Math.max(MIN_LEVELS, Math.min(MAX_LEVELS, Math.round(n) || MIN_LEVELS));
}

function fmtPercent(p: number): string {
  return Number.isInteger(p) ? String(p) : p.toFixed(1);
}

/** The values a fresh (non-custom) level list would have, in the mode's unit. */
export function generateLevelValues(
  mode: LevelMode,
  n: number,
  roiMin: number,
  roiMax: number,
  range: LevelRange = { min: null, max: null }
): number[] {
  const count = clampLevelCount(n);
  if (mode === "percent") {
    return (
      PERCENT_PRESETS[count] ??
      Array.from({ length: count }, (_, i) => Math.round((100 * (i + 1)) / (count + 1)))
    );
  }
  const customRange = range.min != null || range.max != null;
  const lo = range.min ?? roiMin;
  const hi = range.max ?? roiMax;
  const span = hi - lo;
  if (!(span > 0)) return [];
  // A user range means "from here to there"; the automatic range keeps its
  // endpoints clear of the ROI extremes, which never draw a line.
  return Array.from({ length: count }, (_, i) =>
    customRange ? lo + (span * i) / Math.max(1, count - 1) : lo + (span * (i + 1)) / (count + 1)
  );
}

/**
 * Choose contour levels for the ROI.
 *
 * `percent` mode takes the preset percentages of `refMax` (the ROI maximum
 * the statistics report); `absolute` mode spaces `n` levels evenly across the
 * ROI's own dose range, or from the user's range minimum to its maximum
 * inclusive. A `custom` list (in the mode's unit) overrides the generated
 * values. Every level is kept, so the legend always shows what was asked
 * for; a level outside the ROI dose range simply draws no line.
 */
export function contourLevels(
  mode: LevelMode,
  n: number,
  refMax: number | null,
  roiMin: number,
  roiMax: number,
  range: LevelRange = { min: null, max: null },
  custom: number[] | null = null
): ContourLevels {
  const customValues = custom?.filter((v) => Number.isFinite(v)) ?? [];
  const isCustom = customValues.length > 0;
  const values = isCustom ? customValues : generateLevelValues(mode, n, roiMin, roiMax, range);
  const ordered = Array.from(new Set(values)).sort((a, b) => a - b);

  let levels: number[] = [];
  let labels: string[] = [];
  let short: string[] = [];
  if (mode === "percent") {
    if (refMax != null && refMax > 0) {
      levels = ordered.map((p) => (p / 100) * refMax);
      labels = ordered.map((p) => `${fmtPercent(p)}%`);
      short = labels;
    }
  } else {
    const span = ordered.length > 1 ? ordered[ordered.length - 1] - ordered[0] : roiMax - roiMin;
    const decimals = span < 0.5 ? 3 : 2;
    levels = ordered;
    labels = ordered.map((v) => `${v.toFixed(decimals)} Gy`);
    short = ordered.map((v) => v.toFixed(decimals));
  }

  const bandLabels: string[] = [];
  if (short.length) {
    const unit = mode === "percent" ? "" : " Gy";
    bandLabels.push(`< ${short[0]}${unit}`);
    for (let i = 1; i < short.length; i++) {
      bandLabels.push(`${short[i - 1]}–${short[i]}${unit}`);
    }
    bandLabels.push(`≥ ${short[short.length - 1]}${unit}`);
  }

  return { mode, levels, labels, bandLabels, values, custom: isCustom };
}
