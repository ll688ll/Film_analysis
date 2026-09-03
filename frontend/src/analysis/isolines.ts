/** Isodose bands and lines derived from an ROI crop. */

import type { ContourLevels } from "./contourLevels";
import {
  chaikin,
  isClosedPath,
  isolinesFromGrid,
  type ScalarGrid,
} from "./marchingSquares";
import { cropGridToImage, type RoiCrop } from "./roiCrop";
import type { Isoline } from "./roiTypes";

/** Paths shorter than this are film noise, not isodose lines, once smoothing is on. */
const MIN_SMOOTH_PATH_POINTS = 8;

/**
 * NaN-aware 3×3 mean filter. Film grain makes a flat region cross a nearby
 * level thousands of times; one pass of averaging turns that into the few
 * lines a physicist expects while keeping the edges where they are.
 */
function smoothGrid(z: Float32Array, cols: number, rows: number): Float32Array {
  const out = new Float32Array(z.length);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (Number.isNaN(z[i])) {
        out[i] = NaN;
        continue;
      }
      let sum = 0;
      let n = 0;
      for (let dr = -1; dr <= 1; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= rows) continue;
        for (let dc = -1; dc <= 1; dc++) {
          const cc = c + dc;
          if (cc < 0 || cc >= cols) continue;
          const v = z[rr * cols + cc];
          if (Number.isNaN(v)) continue;
          sum += v;
          n++;
        }
      }
      out[i] = sum / n;
    }
  }
  return out;
}

/** The field the bands and lines are computed from: the crop, optionally smoothed. */
export function contourField(crop: RoiCrop, smooth: boolean): ScalarGrid {
  return {
    z: smooth ? smoothGrid(crop.z, crop.cols, crop.rows) : crop.z,
    cols: crop.cols,
    rows: crop.rows,
  };
}

/**
 * For every crop cell, the number of levels at or below its dose
 * (0 … levels.length), or null outside the ROI. Drawn as a stepped heatmap.
 */
export function bandIndexGrid(field: ScalarGrid, levels: number[]): (number | null)[][] {
  const out: (number | null)[][] = [];
  for (let r = 0; r < field.rows; r++) {
    const row: (number | null)[] = new Array(field.cols);
    for (let c = 0; c < field.cols; c++) {
      const v = field.z[r * field.cols + c];
      if (Number.isNaN(v)) {
        row[c] = null;
        continue;
      }
      let k = 0;
      for (const L of levels) if (v >= L) k++;
      row[c] = k;
    }
    out.push(row);
  }
  return out;
}

/** Dose per cell as a nested array with null gaps, for heatmap hover text. */
export function doseGrid(field: ScalarGrid): (number | null)[][] {
  const out: (number | null)[][] = [];
  for (let r = 0; r < field.rows; r++) {
    const row: (number | null)[] = new Array(field.cols);
    for (let c = 0; c < field.cols; c++) {
      const v = field.z[r * field.cols + c];
      row[c] = Number.isNaN(v) ? null : v;
    }
    out.push(row);
  }
  return out;
}

/** Isolines in image pixels for the given levels. */
export function buildIsolines(
  crop: RoiCrop,
  levels: ContourLevels,
  smooth: boolean
): Isoline[] {
  const field = contourField(crop, smooth);
  const minPoints = smooth ? MIN_SMOOTH_PATH_POINTS : 3;
  return levels.levels.map((level, i) => {
    let paths = isolinesFromGrid(field, level).filter((p) => p.length / 2 >= minPoints);
    if (smooth && crop.step > 1) {
      paths = paths.map((p) => chaikin(p, isClosedPath(p)));
    }
    return {
      level,
      label: levels.labels[i],
      paths: paths.map((p) => {
        const out = new Array<number>(p.length);
        for (let j = 0; j < p.length; j += 2) {
          const [x, y] = cropGridToImage(crop, p[j], p[j + 1]);
          out[j] = x;
          out[j + 1] = y;
        }
        return out;
      }),
    };
  });
}
