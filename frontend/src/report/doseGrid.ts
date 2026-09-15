/**
 * The dose map as it travels inside a report: block-averaged to a few hundred
 * pixels a side and quantised to 16 bits. A 300 dpi film is ~3 M floats and
 * a 1200 dpi scan 45 M; neither belongs in an HTML file, and the report only
 * needs enough to draw the map, recolour it, and read a dose under the cursor.
 */

/** Code reserved for blocks with no finite pixel. */
export const NO_DATA = 0xffff;
const MAX_CODE = 0xfffe;

export interface BlockGrid {
  /** Row-major block means; NaN where a block had no finite pixel. */
  z: Float32Array;
  cols: number;
  rows: number;
  /** Block size in image pixels. */
  step: number;
}

/** Average `dose` over `step x step` blocks so the longer side is at most `maxSide`. */
export function blockMeanGrid(
  dose: Float32Array,
  width: number,
  height: number,
  maxSide: number
): BlockGrid {
  const step = Math.max(1, Math.ceil(Math.max(width, height) / maxSide));
  const cols = Math.ceil(width / step);
  const rows = Math.ceil(height / step);
  const sums = new Float64Array(cols * rows);
  const counts = new Int32Array(cols * rows);
  for (let y = 0; y < height; y++) {
    const gy = Math.floor(y / step);
    const rowBase = y * width;
    const gridBase = gy * cols;
    for (let x = 0; x < width; x++) {
      const d = dose[rowBase + x];
      if (!Number.isFinite(d)) continue;
      const gi = gridBase + Math.floor(x / step);
      sums[gi] += d;
      counts[gi]++;
    }
  }
  const z = new Float32Array(cols * rows);
  for (let i = 0; i < z.length; i++) z[i] = counts[i] > 0 ? sums[i] / counts[i] : NaN;
  return { z, cols, rows, step };
}

export interface QuantRange {
  lo: number;
  hi: number;
  doseMin: number;
  doseMax: number;
  clamped: boolean;
}

/**
 * Pick the range the 16-bit codes span. Film edges and scanner bed give a
 * handful of wild values (the calibration's pole), which would otherwise
 * spend the whole code range on nothing; so the span covers the central
 * 99 % of the blocks, widened to include every value in `include` (the
 * display range and the ROI extremes), and anything outside is clamped.
 */
export function chooseQuantRange(z: Float32Array, include: Array<number | null | undefined>): QuantRange {
  const finite = new Float32Array(z.length);
  let n = 0;
  for (let i = 0; i < z.length; i++) if (Number.isFinite(z[i])) finite[n++] = z[i];
  if (n === 0) return { lo: 0, hi: 1, doseMin: 0, doseMax: 0, clamped: false };
  const sorted = finite.subarray(0, n).slice().sort();
  const doseMin = sorted[0];
  const doseMax = sorted[n - 1];
  let lo = sorted[Math.floor(0.005 * (n - 1))];
  let hi = sorted[Math.ceil(0.995 * (n - 1))];
  for (const v of include) {
    if (v == null || !Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!(hi > lo)) hi = lo + 1;
  return { lo, hi, doseMin, doseMax, clamped: doseMin < lo || doseMax > hi };
}

export function quantize(z: Float32Array, range: QuantRange): Uint16Array {
  const out = new Uint16Array(z.length);
  const scale = MAX_CODE / (range.hi - range.lo);
  for (let i = 0; i < z.length; i++) {
    const v = z[i];
    if (!Number.isFinite(v)) {
      out[i] = NO_DATA;
      continue;
    }
    const t = Math.max(0, Math.min(MAX_CODE, Math.round((v - range.lo) * scale)));
    out[i] = t;
  }
  return out;
}

export function dequantize(codes: Uint16Array, lo: number, hi: number): Float32Array {
  const out = new Float32Array(codes.length);
  const scale = (hi - lo) / MAX_CODE;
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    out[i] = c === NO_DATA ? NaN : lo + c * scale;
  }
  return out;
}

/** Smallest dose difference the quantised grid can express, in Gy. */
export function quantStep(lo: number, hi: number): number {
  return (hi - lo) / MAX_CODE;
}
