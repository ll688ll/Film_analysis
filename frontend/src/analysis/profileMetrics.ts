/**
 * Dose profiles through the ROI centre, along the ROI's own width and height
 * axes, with the beam-profile metrics film users expect: FWHM and the
 * 80–20 % penumbra on each side.
 */

import type { ProfileOffset, ROIData, RoiMaskOptions } from "./roiTypes";
import { makeRoiMask, pxToMm, roiAxes, roiCenter } from "./roiGeometry";

export type ProfileAxis = "h" | "v";

export interface DoseProfile {
  axis: ProfileAxis;
  /** Position along the axis in mm, 0 at the ROI centre line. */
  positionMm: number[];
  dose: number[];
  /** Whether each sample lies inside the ROI mask. */
  inRoi: boolean[];
  /** Half of the ROI extent along this axis, in mm. */
  halfExtentMm: number;
  /** Where the crosshair's other line crosses this profile, in mm. */
  crossMm: number;
  /** How far this line sits from the ROI centre along the other axis, in mm. */
  offsetMm: number;
}

const MARGIN_FRAC = 0.25;
const MIN_MARGIN_PX = 20;

/** Half of the sampled span along `axis` (ROI half-extent plus the margin), in image px. */
export function profileHalfSpan(roi: ROIData, axis: ProfileAxis): number {
  const extent = axis === "h" ? roi.w : roi.h;
  return extent / 2 + Math.max(MIN_MARGIN_PX, MARGIN_FRAC * extent);
}

/** Keep the crosshair inside the ROI box. */
export function clampProfileOffset(offset: ProfileOffset, roi: ROIData): ProfileOffset {
  const hu = roi.w / 2;
  const hv = roi.h / 2;
  return {
    u: Math.max(-hu, Math.min(hu, offset.u)),
    v: Math.max(-hv, Math.min(hv, offset.v)),
  };
}

export const ZERO_OFFSET: ProfileOffset = { u: 0, v: 0 };

export interface ProfileMetrics {
  /** Smoothed maximum inside the ROI extent, the reference for all thresholds. */
  maxDose: number | null;
  maxPosMm: number | null;
  fwhmMm: number | null;
  left50Mm: number | null;
  right50Mm: number | null;
  penumbraLeftMm: number | null;
  penumbraRightMm: number | null;
}

const EMPTY_METRICS: ProfileMetrics = {
  maxDose: null,
  maxPosMm: null,
  fwhmMm: null,
  left50Mm: null,
  right50Mm: null,
  penumbraLeftMm: null,
  penumbraRightMm: null,
};

/**
 * Sample the dose map every image pixel along one ROI axis, extending 25 % of
 * the ROI size (at least 20 px) past each end so the penumbra is visible when
 * the ROI hugs the field edge. `offset` moves the line off the ROI centre:
 * the horizontal profile sits at `offset.v`, the vertical one at `offset.u`.
 */
export function sampleProfile(
  dose: Float32Array,
  width: number,
  height: number,
  roi: ROIData,
  opts: RoiMaskOptions,
  dpi: number,
  axis: ProfileAxis,
  offset: ProfileOffset = ZERO_OFFSET
): DoseProfile | null {
  const centre = roiCenter(roi);
  const { ux, uy, vx, vy } = roiAxes(roi);
  const dirX = axis === "h" ? ux : vx;
  const dirY = axis === "h" ? uy : vy;
  const extent = axis === "h" ? roi.w : roi.h;
  if (!(extent > 0)) return null;

  // The line's anchor: the centre pushed along the *other* axis
  const perp = axis === "h" ? offset.v : offset.u;
  const cx = centre.x + (axis === "h" ? perp * vx : perp * ux);
  const cy = centre.y + (axis === "h" ? perp * vy : perp * uy);

  const half = extent / 2;
  const margin = profileHalfSpan(roi, axis) - half;
  const mask = makeRoiMask(roi, opts);
  // Multiples of 90° hit pixel centres exactly; anything else is interpolated.
  const bilinear = roi.rotation % 90 !== 0;

  const sampleAt = (px: number, py: number): number | null => {
    if (px < 0 || py < 0 || px > width - 1 || py > height - 1) return null;
    if (!bilinear) return dose[Math.round(py) * width + Math.round(px)];
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const x1 = Math.min(x0 + 1, width - 1);
    const y1 = Math.min(y0 + 1, height - 1);
    const fx = px - x0;
    const fy = py - y0;
    const d00 = dose[y0 * width + x0];
    const d10 = dose[y0 * width + x1];
    const d01 = dose[y1 * width + x0];
    const d11 = dose[y1 * width + x1];
    return (d00 * (1 - fx) + d10 * fx) * (1 - fy) + (d01 * (1 - fx) + d11 * fx) * fy;
  };

  const positionMm: number[] = [];
  const values: number[] = [];
  const inRoi: boolean[] = [];
  for (let s = -(half + margin); s <= half + margin; s += 1) {
    const px = cx + s * dirX;
    const py = cy + s * dirY;
    const d = sampleAt(px, py);
    if (d === null || !isFinite(d)) continue;
    positionMm.push(pxToMm(s, dpi));
    values.push(d);
    inRoi.push(mask(Math.round(px), Math.round(py), d));
  }
  if (values.length === 0) return null;

  return {
    axis,
    positionMm,
    dose: values,
    inRoi,
    halfExtentMm: pxToMm(half, dpi),
    crossMm: pxToMm(axis === "h" ? offset.u : offset.v, dpi),
    offsetMm: pxToMm(perp, dpi),
  };
}

function movingAverage(values: number[], window: number): number[] {
  const n = values.length;
  const halfWin = Math.floor(window / 2);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - halfWin); j <= Math.min(n - 1, i + halfWin); j++) {
      sum += values[j];
      count++;
    }
    out[i] = sum / count;
  }
  return out;
}

/**
 * FWHM and 80–20 % penumbra from a profile. Thresholds are fractions of the
 * profile maximum found *inside* the ROI extent (a neighbouring field in the
 * margin must not become the reference), and crossings are located by
 * linear interpolation walking outwards from that maximum. Any crossing
 * that never happens leaves its metric null.
 */
export function profileMetrics(
  profile: DoseProfile | null,
  smoothWindow = 5
): ProfileMetrics {
  if (!profile || profile.dose.length < 3) return EMPTY_METRICS;
  const pos = profile.positionMm;
  const sm = movingAverage(profile.dose, smoothWindow);
  const n = sm.length;

  let im = -1;
  let mx = -Infinity;
  for (let i = 0; i < n; i++) {
    if (Math.abs(pos[i]) <= profile.halfExtentMm && sm[i] > mx) {
      mx = sm[i];
      im = i;
    }
  }
  if (im < 0 || !(mx > 0)) return EMPTY_METRICS;

  const cross = (frac: number, dir: -1 | 1): number | null => {
    const thr = frac * mx;
    let i = im;
    while (i + dir >= 0 && i + dir < n && sm[i + dir] >= thr) i += dir;
    const j = i + dir;
    if (j < 0 || j >= n) return null;
    const denom = sm[j] - sm[i];
    if (denom === 0) return pos[i];
    return pos[i] + ((thr - sm[i]) * (pos[j] - pos[i])) / denom;
  };

  const l50 = cross(0.5, -1);
  const r50 = cross(0.5, 1);
  const l80 = cross(0.8, -1);
  const l20 = cross(0.2, -1);
  const r80 = cross(0.8, 1);
  const r20 = cross(0.2, 1);

  return {
    maxDose: mx,
    maxPosMm: pos[im],
    fwhmMm: l50 !== null && r50 !== null ? r50 - l50 : null,
    left50Mm: l50,
    right50Mm: r50,
    penumbraLeftMm: l80 !== null && l20 !== null ? Math.abs(l80 - l20) : null,
    penumbraRightMm: r80 !== null && r20 !== null ? Math.abs(r20 - r80) : null,
  };
}
