/**
 * Window/Level display adjustment.
 *
 * A display-only transfer function, in the radiology sense: `level` is the
 * centre of the displayed intensity range and `window` its width, so values
 * below `level - window/2` render black and values above `level + window/2`
 * render white, with a linear ramp between.
 *
 * This never touches the analysis. Level boundaries, pixel counts, and
 * percentages are unaffected by anything in this module -- you can hunt for
 * faint detail without silently moving the numbers you report.
 */

export interface WindowLevel {
  /** Centre of the displayed range, in source intensity units. */
  level: number;
  /** Width of the displayed range, in source intensity units. */
  window: number;
  invert: boolean;
}

/** Windows narrower than this collapse the ramp to a step. */
const MIN_WINDOW = 1e-9;

export function wlToRange(wl: WindowLevel): [number, number] {
  const half = Math.max(wl.window, MIN_WINDOW) / 2;
  return [wl.level - half, wl.level + half];
}

export function rangeToWl(lo: number, hi: number, invert = false): WindowLevel {
  return {
    level: (lo + hi) / 2,
    window: Math.max(hi - lo, MIN_WINDOW),
    invert,
  };
}

/** Full data range -- the identity transfer function. */
export function fullRangeWL(dataMin: number, dataMax: number, invert = false): WindowLevel {
  return rangeToWl(dataMin, dataMax, invert);
}

/** Percentile-based auto contrast, ignoring outliers at both tails. */
export function autoWL(p1: number, p99: number, invert = false): WindowLevel {
  return rangeToWl(p1, p99, invert);
}

/** True when the transfer function is (near enough) the identity. */
export function isFullRange(
  wl: WindowLevel,
  dataMin: number,
  dataMax: number
): boolean {
  if (wl.invert) return false;
  const [lo, hi] = wlToRange(wl);
  const span = Math.max(dataMax - dataMin, MIN_WINDOW);
  return Math.abs(lo - dataMin) < span * 1e-6 && Math.abs(hi - dataMax) < span * 1e-6;
}

/**
 * Grayscale backdrop table indexed by bin code, matching the layout the level
 * LUT uses so it can go through the same `applyLevelLUT` painter.
 *
 * Entry `bins` is the no-data code and stays transparent.
 */
export function buildBackdropLUT(
  bins: number,
  valueMin: number,
  binWidth: number,
  wl: WindowLevel
): Uint8Array {
  const lut = new Uint8Array((bins + 1) * 4);
  const [lo, hi] = wlToRange(wl);
  const span = hi - lo;
  const invSpan = Math.abs(span) > MIN_WINDOW ? 1 / span : 0;

  for (let b = 0; b < bins; b++) {
    // Bin centre: the plane carries codes, so this is the value it represents.
    const value = valueMin + (b + 0.5) * binWidth;
    let t = invSpan === 0 ? (value >= lo ? 1 : 0) : (value - lo) * invSpan;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    if (wl.invert) t = 1 - t;

    const g = Math.round(t * 255);
    const k = b * 4;
    lut[k] = g;
    lut[k + 1] = g;
    lut[k + 2] = g;
    lut[k + 3] = 255;
  }

  const nodata = bins * 4;
  lut[nodata] = 0;
  lut[nodata + 1] = 0;
  lut[nodata + 2] = 0;
  lut[nodata + 3] = 0;
  return lut;
}

/** Which image sits under the level map. */
export type BackdropMode = "original" | "windowed";
