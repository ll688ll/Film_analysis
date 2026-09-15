/**
 * Build a report payload from what the Film Dose page already holds. Runs in
 * the app, not in the report; every number a reader sees was computed here
 * or by the server, with the same code the analysis panel uses.
 */

import { cornerCutPx } from "../analysis/roiGeometry";
import { extractRoiCrop } from "../analysis/roiCrop";
import { sampleProfile, type DoseProfile } from "../analysis/profileMetrics";
import type {
  ContourSettings,
  ProfileOffset,
  ROIData,
  ROIStats,
  RoiMaskOptions,
  RoiSettings,
} from "../analysis/roiTypes";
import type { ColormapName } from "../analysis/colormaps";
import { encodeBytes, float32ToBytes, uint16ToBytes } from "./encode";
import { blockMeanGrid, chooseQuantRange, quantize } from "./doseGrid";
import {
  REPORT_SCHEMA,
  type ReportCalibration,
  type ReportCrop,
  type ReportFilm,
  type ReportMeta,
  type ReportPayload,
  type ReportRoi,
} from "./reportTypes";

/** Longest side of the embedded dose grid, in blocks. */
export const GRID_MAX_SIDE = 800;
/** Longest side of the embedded scan thumbnail, in pixels. */
export const THUMBNAIL_MAX_SIDE = 800;

export interface ReportSource {
  version: string | null;
  meta: ReportMeta;
  film: ReportFilm;
  /** Blob URL of the film preview, if loaded. */
  previewUrl: string | null;
  calibration: ReportCalibration;
  display: { colormap: ColormapName; cmapMin: number; cmapMax: number };
  dose: { array: Float32Array; width: number; height: number };
  roi: {
    geometry: ROIData;
    settings: RoiSettings;
    stats: ROIStats;
    contour: ContourSettings;
    profileOffset: ProfileOffset;
  } | null;
}

function round(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

/** Trim a profile's arrays to a sensible precision; they are plain JSON. */
function compactProfile(p: DoseProfile | null): DoseProfile | null {
  if (!p) return null;
  return {
    ...p,
    positionMm: p.positionMm.map((v) => round(v, 3)),
    dose: p.dose.map((v) => round(v, 5)),
    halfExtentMm: round(p.halfExtentMm, 3),
    crossMm: round(p.crossMm, 3),
    offsetMm: round(p.offsetMm, 3),
  };
}

async function makeThumbnail(previewUrl: string | null): Promise<string | null> {
  if (!previewUrl) return null;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("preview failed to load"));
      el.src = previewUrl;
    });
    const scale = Math.min(1, THUMBNAIL_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return null;
  }
}

async function buildRoi(src: ReportSource): Promise<ReportRoi | null> {
  const roi = src.roi;
  if (!roi) return null;
  const { array, width, height } = src.dose;
  const dpi = src.film.dpi;
  const s = roi.settings;
  const maskOpts: RoiMaskOptions = {
    roiType: s.roiType,
    holeRatio: s.holeRatio,
    threshold: s.threshold,
    cornerCutPx: cornerCutPx(s.roiType, s.cornerCutEnabled, s.cornerCutMm, dpi),
  };

  const crop = extractRoiCrop(array, width, height, roi.geometry, maskOpts, dpi);
  let encodedCrop: ReportCrop | null = null;
  if (crop) {
    encodedCrop = {
      x0: crop.x0,
      y0: crop.y0,
      step: crop.step,
      cols: crop.cols,
      rows: crop.rows,
      z: await encodeBytes(float32ToBytes(crop.z)),
      xMm: crop.xMm.map((v) => round(v, 4)),
      yMm: crop.yMm.map((v) => round(v, 4)),
      roiMin: crop.roiMin,
      roiMax: crop.roiMax,
      maskedCount: crop.maskedCount,
    };
  }

  const h = sampleProfile(array, width, height, roi.geometry, maskOpts, dpi, "h", roi.profileOffset);
  const v = sampleProfile(array, width, height, roi.geometry, maskOpts, dpi, "v", roi.profileOffset);

  return {
    roiType: s.roiType,
    geometry: roi.geometry,
    holeRatio: s.holeRatio,
    threshold: s.threshold,
    trimEnabled: s.trimEnabled,
    trimPercent: s.trimPercent,
    cornerCutEnabled: s.roiType === "Rectangle" && s.cornerCutEnabled,
    cornerCutMm: s.cornerCutMm,
    stats: roi.stats,
    crop: encodedCrop,
    contour: roi.contour,
    profileOffset: roi.profileOffset,
    profiles: { h: compactProfile(h), v: compactProfile(v) },
  };
}

export async function buildReportPayload(src: ReportSource): Promise<ReportPayload> {
  const { array, width, height } = src.dose;
  const grid = blockMeanGrid(array, width, height, GRID_MAX_SIDE);
  const range = chooseQuantRange(grid.z, [
    src.display.cmapMin,
    src.display.cmapMax,
    src.roi?.stats.min,
    src.roi?.stats.max,
  ]);
  const codes = quantize(grid.z, range);
  const encodedGrid = await encodeBytes(uint16ToBytes(codes));

  const [filmThumbnail, roi] = await Promise.all([makeThumbnail(src.previewUrl), buildRoi(src)]);

  return {
    schema: REPORT_SCHEMA,
    app: { name: "Film Analysis", version: src.version },
    generatedAt: new Date().toISOString(),
    meta: src.meta,
    film: src.film,
    filmThumbnail,
    calibration: src.calibration,
    display: src.display,
    doseGrid: {
      ...encodedGrid,
      cols: grid.cols,
      rows: grid.rows,
      step: grid.step,
      lo: range.lo,
      hi: range.hi,
      doseMin: range.doseMin,
      doseMax: range.doseMax,
      clamped: range.clamped,
    },
    roi,
  };
}
