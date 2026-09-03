/**
 * A block-averaged, masked crop of the dose map around the ROI: the input
 * for the contour view and its isolines.
 */

import { makeRoiMask, pxToMm, roiBoundingBox } from "./roiGeometry";
import type { ROIData, RoiMaskOptions } from "./roiTypes";

export interface RoiCrop {
  /** Image-pixel origin of the crop and the block size in pixels. */
  x0: number;
  y0: number;
  step: number;
  cols: number;
  rows: number;
  /** Row-major block means; NaN where a block is (mostly) outside the ROI. */
  z: Float32Array;
  /** Block-centre positions in mm, per column / per row. */
  xMm: number[];
  yMm: number[];
  roiMin: number;
  roiMax: number;
  maskedCount: number;
}

/** Image-pixel x of grid column `gx` (cell centre); same for rows. */
export function cropGridToImage(crop: RoiCrop, gx: number, gy: number): [number, number] {
  const half = (crop.step - 1) / 2;
  return [crop.x0 + gx * crop.step + half, crop.y0 + gy * crop.step + half];
}

export function extractRoiCrop(
  dose: Float32Array,
  width: number,
  height: number,
  roi: ROIData,
  opts: RoiMaskOptions,
  dpi: number,
  maxSide = 160
): RoiCrop | null {
  const box = roiBoundingBox(roi, width, height, 1);
  if (!box) return null;
  const bw = box.x1 - box.x0 + 1;
  const bh = box.y1 - box.y0 + 1;
  const step = Math.max(1, Math.ceil(Math.max(bw, bh) / maxSide));
  const cols = Math.ceil(bw / step);
  const rows = Math.ceil(bh / step);

  const sums = new Float64Array(cols * rows);
  const counts = new Int32Array(cols * rows);
  const mask = makeRoiMask(roi, opts);

  let roiMin = Infinity;
  let roiMax = -Infinity;
  let maskedCount = 0;

  for (let iy = box.y0; iy <= box.y1; iy++) {
    const rowBase = iy * width;
    const gy = Math.floor((iy - box.y0) / step);
    for (let ix = box.x0; ix <= box.x1; ix++) {
      const d = dose[rowBase + ix];
      if (!Number.isFinite(d) || !mask(ix, iy, d)) continue;
      const gi = gy * cols + Math.floor((ix - box.x0) / step);
      sums[gi] += d;
      counts[gi]++;
      maskedCount++;
      if (d < roiMin) roiMin = d;
      if (d > roiMax) roiMax = d;
    }
  }
  if (maskedCount === 0) return null;

  const z = new Float32Array(cols * rows);
  for (let gy = 0; gy < rows; gy++) {
    // Blocks clipped by the image edge are smaller; judge them by their real size
    const blockH = Math.min(step, box.y1 - box.y0 + 1 - gy * step);
    for (let gx = 0; gx < cols; gx++) {
      const blockW = Math.min(step, box.x1 - box.x0 + 1 - gx * step);
      const gi = gy * cols + gx;
      const n = counts[gi];
      z[gi] = n > 0 && n * 2 >= blockW * blockH ? sums[gi] / n : NaN;
    }
  }

  const half = (step - 1) / 2;
  return {
    x0: box.x0,
    y0: box.y0,
    step,
    cols,
    rows,
    z,
    xMm: Array.from({ length: cols }, (_, c) => pxToMm(box.x0 + c * step + half, dpi)),
    yMm: Array.from({ length: rows }, (_, r) => pxToMm(box.y0 + r * step + half, dpi)),
    roiMin,
    roiMax,
    maskedCount,
  };
}
