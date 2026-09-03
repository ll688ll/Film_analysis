/**
 * ROI geometry helpers that mirror `build_roi_mask` in
 * `backend/app/services/film_analyzer.py`, so anything computed in the
 * browser (contour crop, profiles) covers exactly the pixels the server
 * uses for statistics.
 */

import type { ROIData, ROIType, RoiMaskOptions } from "./roiTypes";

export const MM_PER_INCH = 25.4;

export function pxToMm(px: number, dpi: number): number {
  return dpi > 0 ? (px * MM_PER_INCH) / dpi : px;
}

/** Chamfer leg length in image pixels; zero unless it applies (same guard as the API). */
export function cornerCutPx(
  roiType: ROIType,
  enabled: boolean,
  mm: number,
  dpi: number
): number {
  return roiType === "Rectangle" && enabled && mm > 0
    ? (mm * dpi) / MM_PER_INCH
    : 0;
}

export function roiCenter(roi: ROIData): { x: number; y: number } {
  return { x: roi.x + roi.w / 2, y: roi.y + roi.h / 2 };
}

/**
 * Unit vectors of the ROI's own width axis (u) and height axis (v) in image
 * space. Positive rotation is clockwise on screen, as in Konva and the API.
 */
export function roiAxes(roi: ROIData): {
  ux: number;
  uy: number;
  vx: number;
  vy: number;
} {
  const t = (roi.rotation * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return { ux: c, uy: s, vx: -s, vy: c };
}

/** Inclusive pixel box. */
export interface PixelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Axis-aligned bounding box of the (possibly rotated) ROI, clamped to the
 * image, with `margin` extra pixels on each side. Null when nothing of the
 * ROI lies inside the image.
 */
export function roiBoundingBox(
  roi: ROIData,
  imageWidth: number,
  imageHeight: number,
  margin = 1
): PixelBox | null {
  const { x: cx, y: cy } = roiCenter(roi);
  const { ux, uy, vx, vy } = roiAxes(roi);
  const hw = roi.w / 2;
  const hh = roi.h / 2;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const su of [-1, 1]) {
    for (const sv of [-1, 1]) {
      const px = cx + su * hw * ux + sv * hh * vx;
      const py = cy + su * hw * uy + sv * hh * vy;
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
  }

  const x0 = Math.max(0, Math.floor(minX) - margin);
  const x1 = Math.min(imageWidth - 1, Math.ceil(maxX) + margin);
  const y0 = Math.max(0, Math.floor(minY) - margin);
  const y1 = Math.min(imageHeight - 1, Math.ceil(maxY) + margin);
  if (x1 < x0 || y1 < y0) return null;
  return { x0, y0, x1, y1 };
}

/** Membership test for one pixel, evaluated at integer coordinates like `np.ogrid`. */
export type RoiMaskFn = (ix: number, iy: number, dose: number) => boolean;

export function makeRoiMask(roi: ROIData, opts: RoiMaskOptions): RoiMaskFn {
  const { x: cx, y: cy } = roiCenter(roi);
  const threshold = opts.threshold > 0 ? opts.threshold : null;
  const passesThreshold = (d: number) => threshold === null || d > threshold;

  if (opts.roiType === "Rectangle") {
    const hw = roi.w / 2;
    const hh = roi.h / 2;
    // The backend rotates by -rotation to bring pixels into the box frame.
    const rad = (-roi.rotation * Math.PI) / 180;
    const ca = Math.cos(rad);
    const sa = Math.sin(rad);
    const cut = opts.cornerCutPx > 0 ? Math.min(opts.cornerCutPx, hw, hh) : 0;
    return (ix, iy, d) => {
      const dx = ix - cx;
      const dy = iy - cy;
      const au = Math.abs(dx * ca - dy * sa);
      const av = Math.abs(dx * sa + dy * ca);
      if (au > hw || av > hh) return false;
      if (cut > 0 && hw - au + (hh - av) < cut) return false;
      return passesThreshold(d);
    };
  }

  const rx = roi.w / 2;
  const ry = roi.h / 2;
  if (rx === 0 || ry === 0) return () => false;
  const hole2 = opts.roiType === "Ring" ? (opts.holeRatio / 100) ** 2 : -1;
  return (ix, iy, d) => {
    const dx = (ix - cx) / rx;
    const dy = (iy - cy) / ry;
    const dist = dx * dx + dy * dy;
    if (dist > 1 || dist < hole2) return false;
    return passesThreshold(d);
  };
}
