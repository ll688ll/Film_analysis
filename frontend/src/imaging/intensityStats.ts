/**
 * Pure statistics over the augmented histogram. No React, no network.
 *
 * The server sends per-bin count, sum, and sum-of-squares once; every level
 * statistic is then derived here in O(bins), so dragging a threshold or
 * changing the level count recomputes the whole table without a round-trip.
 *
 * The derivation is exact -- not an approximation from bin midpoints --
 * provided level boundaries land on bin edges. `Level` stores bin indices
 * rather than values precisely to guarantee that.
 */

import type { Histogram, Level, LevelStat } from "./types";

export interface Prefix {
  /** Cumulative counts; c0[i] is the total below bin i. Length bins + 1. */
  c0: Float64Array;
  c1: Float64Array;
  c2: Float64Array;
}

export function buildPrefix(hist: Histogram): Prefix {
  const n = hist.bins;
  const c0 = new Float64Array(n + 1);
  const c1 = new Float64Array(n + 1);
  const c2 = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    c0[i + 1] = c0[i] + hist.counts[i];
    c1[i + 1] = c1[i] + hist.sums[i];
    c2[i + 1] = c2[i] + hist.sumsqs[i];
  }
  return { c0, c1, c2 };
}

export interface BinRangeStats {
  count: number;
  mean: number | null;
  std: number | null;
}

/** Exact count / mean / std over the inclusive bin range [loBin, hiBin]. */
export function statsForBinRange(
  prefix: Prefix,
  loBin: number,
  hiBin: number
): BinRangeStats {
  const lo = Math.max(0, loBin);
  const hi = Math.min(prefix.c0.length - 2, hiBin);
  if (hi < lo) return { count: 0, mean: null, std: null };

  const n = prefix.c0[hi + 1] - prefix.c0[lo];
  if (n <= 0) return { count: 0, mean: null, std: null };

  const s = prefix.c1[hi + 1] - prefix.c1[lo];
  const q = prefix.c2[hi + 1] - prefix.c2[lo];
  const mean = s / n;
  // Clamp: catastrophic cancellation can push a zero variance slightly negative.
  const variance = Math.max(0, q / n - mean * mean);
  return { count: n, mean, std: Math.sqrt(variance) };
}

export function binToValue(hist: Histogram, bin: number): number {
  return hist.value_min + bin * hist.bin_width;
}

/** Nearest bin index for a value, clamped to [0, bins - 1]. */
export function valueToBin(hist: Histogram, value: number): number {
  if (hist.bin_width <= 0) return 0;
  const b = Math.floor((value - hist.value_min) / hist.bin_width);
  return Math.max(0, Math.min(hist.bins - 1, b));
}

function firstNonEmpty(hist: Histogram, lo: number, hi: number): number | null {
  for (let i = lo; i <= hi; i++) if (hist.counts[i] > 0) return i;
  return null;
}

function lastNonEmpty(hist: Histogram, lo: number, hi: number): number | null {
  for (let i = hi; i >= lo; i--) if (hist.counts[i] > 0) return i;
  return null;
}

/** Per-level statistics for the table. */
export function levelStatsFromHistogram(
  hist: Histogram,
  prefix: Prefix,
  levels: Level[]
): LevelStat[] {
  const total = hist.total_count;
  return levels.map((level) => {
    const { count, mean, std } = statsForBinRange(prefix, level.loBin, level.hiBin);
    const lo = firstNonEmpty(hist, level.loBin, level.hiBin);
    const hi = lastNonEmpty(hist, level.loBin, level.hiBin);
    return {
      index: level.index,
      loBin: level.loBin,
      hiBin: level.hiBin,
      lower: binToValue(hist, level.loBin),
      upper: binToValue(hist, level.hiBin + 1),
      count,
      countPct: total > 0 ? (count / total) * 100 : 0,
      mean,
      std,
      minApprox: lo === null ? null : binToValue(hist, lo),
      maxApprox: hi === null ? null : binToValue(hist, hi + 1),
    };
  });
}

// ---------------------------------------------------------------------------
// Boundary generation (the methods that need no server round-trip)
// ---------------------------------------------------------------------------

/** Clamp to [1, bins - 1], force strict increase, drop collisions. */
export function dedupeIncreasing(
  edges: number[],
  bins: number,
  wanted: number
): number[] {
  const out: number[] = [];
  for (const raw of [...edges].sort((a, b) => a - b)) {
    let e = Math.min(Math.max(Math.round(raw), 1), bins - 1);
    if (out.length && e <= out[out.length - 1]) e = out[out.length - 1] + 1;
    if (e >= bins) break;
    out.push(e);
  }
  return out.slice(0, wanted);
}

export function equalWidthEdges(bins: number, levels: number): number[] {
  const edges: number[] = [];
  for (let i = 1; i < levels; i++) edges.push(Math.round((i * bins) / levels));
  return dedupeIncreasing(edges, bins, levels - 1);
}

/**
 * Move an edge to the middle of the empty run it sits in, if any.
 *
 * Mirrors `_center_in_tie_plateau` in the backend. When clusters are cleanly
 * separated, every boundary inside the gap yields identical populations; the
 * leftmost one hugs the lower cluster and reads badly on a histogram. This
 * must match the server exactly, or switching methods would shift boundaries.
 */
export function centerInEmptyRun(counts: number[], edge: number): number {
  const bins = counts.length;
  let lo = edge;
  while (lo > 0 && counts[lo - 1] === 0) lo--;
  let hi = edge;
  while (hi < bins && counts[hi] === 0) hi++;
  return Math.floor((lo + hi) / 2);
}

export function equalCountEdges(hist: Histogram, levels: number): number[] {
  const total = hist.total_count;
  if (total <= 0 || levels <= 1) return [];

  const edges: number[] = [];
  let cum = 0;
  let target = 1;
  for (let i = 0; i < hist.bins && target < levels; i++) {
    cum += hist.counts[i];
    while (target < levels && cum >= (target * total) / levels) {
      edges.push(centerInEmptyRun(hist.counts, i + 1));
      target++;
    }
  }
  return dedupeIncreasing(edges, hist.bins, levels - 1);
}

/** Convert interior boundaries to the full [0, ..., bins] bound list. */
export function edgesToBounds(edgeBins: number[], bins: number): number[] {
  return [0, ...edgeBins, bins];
}

/** Build levels from bound bins, carrying colours and labels forward. */
export function levelsFromBounds(
  bounds: number[],
  colors: string[],
  previous?: Level[]
): Level[] {
  const out: Level[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const prev = previous?.[i];
    out.push({
      index: i,
      loBin: bounds[i],
      hiBin: bounds[i + 1] - 1,
      color: prev?.customColor ? prev.color : colors[i] ?? "#888888",
      label: prev?.label ?? `L${i + 1}`,
      visible: prev?.visible ?? true,
      locked: prev?.locked ?? false,
      customColor: prev?.customColor,
    });
  }
  return out;
}

/** Which level a bin code belongs to, or null for no-data / uncovered. */
export function levelForBin(levels: Level[], bin: number): Level | null {
  for (const l of levels) if (bin >= l.loBin && bin <= l.hiBin) return l;
  return null;
}
