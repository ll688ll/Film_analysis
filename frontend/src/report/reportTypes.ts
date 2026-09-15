/**
 * The report payload: everything a standalone HTML report needs, serialised
 * as one JSON object inside the file. The Film Dose page builds it
 * (`buildReport.ts`); the viewer bundle reads it back (`main.tsx`).
 *
 * Treat this as a versioned contract: bump `REPORT_SCHEMA` when a change
 * would stop an older viewer from reading a newer payload, or the reverse.
 */

import type { ColormapName } from "../analysis/colormaps";
import type { DoseProfile } from "../analysis/profileMetrics";
import type {
  ContourSettings,
  ProfileOffset,
  ROIData,
  ROIStats,
  ROIType,
} from "../analysis/roiTypes";

export const REPORT_SCHEMA = 1;

/** id of the inline `<script type="application/json">` carrying the payload. */
export const REPORT_DATA_ID = "film-report-data";
/** id of the element the viewer renders into. */
export const REPORT_ROOT_ID = "film-report";

/** What the author types into the export dialog. */
export interface ReportMeta {
  title: string;
  author: string;
  institution: string;
  comment: string;
}

export interface ReportFilm {
  filename: string | null;
  width: number;
  height: number;
  dpi: number;
  channels: number;
  /** 8 or 16 bits per sample; null when the server could not tell. */
  bitDepth: number | null;
  notes: string;
  project: string | null;
  savedAnalysisId: number | null;
}

export interface ReportCalibrationChannel {
  channel: string;
  a: number;
  b: number;
  c: number;
  r_squared: number | null;
}

export interface ReportCalibrationPoint {
  dose: number;
  /** Colour fractions, 0-1, as the wizard stores them. */
  red_pct: number;
  green_pct: number;
  blue_pct: number;
}

export interface ReportCalibration {
  profileName: string | null;
  profileNote: string;
  /**
   * Where the profile details came from: the immutable snapshot of a
   * reopened analysis, the live profile, or hand-entered coefficients.
   */
  source: "snapshot" | "profile" | "manual";
  /** The coefficients the dose map was actually computed with. */
  channel: string;
  a: number;
  b: number;
  c: number;
  channels: ReportCalibrationChannel[];
  points: ReportCalibrationPoint[];
}

/** Bytes as text: gzip is used when the exporting browser can compress. */
export interface EncodedBytes {
  encoding: "gzip-base64" | "base64";
  data: string;
}

/**
 * The full dose map, block-averaged and quantised to 16 bits so a 45 MP scan
 * fits in a file: `value = lo + code * (hi - lo) / 65534`, code 65535 = no data.
 */
export interface ReportDoseGrid extends EncodedBytes {
  cols: number;
  rows: number;
  /** Block size in image pixels. */
  step: number;
  lo: number;
  hi: number;
  /** True extremes of the block means before clamping to [lo, hi]. */
  doseMin: number;
  doseMax: number;
  clamped: boolean;
}

/** `RoiCrop` with its float32 grid encoded. */
export interface ReportCrop {
  x0: number;
  y0: number;
  step: number;
  cols: number;
  rows: number;
  z: EncodedBytes;
  xMm: number[];
  yMm: number[];
  roiMin: number;
  roiMax: number;
  maskedCount: number;
}

export interface ReportRoi {
  roiType: ROIType;
  geometry: ROIData;
  holeRatio: number;
  threshold: number;
  trimEnabled: boolean;
  trimPercent: number;
  cornerCutEnabled: boolean;
  cornerCutMm: number;
  /** As the server computed them on the full-resolution map, histogram included. */
  stats: ROIStats;
  crop: ReportCrop | null;
  /** The contour view's settings at export time; the reader can change them. */
  contour: ContourSettings;
  profileOffset: ProfileOffset;
  profiles: {
    h: DoseProfile | null;
    v: DoseProfile | null;
  };
}

export interface ReportPayload {
  schema: number;
  app: { name: string; version: string | null };
  /** ISO timestamp of the export. */
  generatedAt: string;
  meta: ReportMeta;
  film: ReportFilm;
  /** JPEG data URL of the scan, downsampled; null if the preview was unavailable. */
  filmThumbnail: string | null;
  calibration: ReportCalibration;
  display: {
    colormap: ColormapName;
    cmapMin: number;
    cmapMax: number;
  };
  doseGrid: ReportDoseGrid;
  roi: ReportRoi | null;
}
