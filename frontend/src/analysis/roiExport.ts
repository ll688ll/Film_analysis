/**
 * Copy and CSV export for the ROI panel. Everything is already in the
 * browser, so there is no export endpoint.
 */

import { baseName, copyToClipboard, downloadCSV } from "../imaging/exporters";
import { fmt } from "./format";
import type { DoseProfile, ProfileMetrics } from "./profileMetrics";
import type { ROIStats, RoiHistogramData } from "./roiTypes";

export interface StatRow {
  key: keyof ROIStats;
  label: string;
  decimals: number;
  unit: string;
}

/** The statistics table, in display order. */
export const STAT_ROWS: StatRow[] = [
  { key: "max", label: "Dose Max", decimals: 3, unit: "Gy" },
  { key: "min", label: "Dose Min", decimals: 3, unit: "Gy" },
  { key: "mean", label: "Dose Mean", decimals: 3, unit: "Gy" },
  { key: "median", label: "Median", decimals: 3, unit: "Gy" },
  { key: "std", label: "Dose Std", decimals: 3, unit: "Gy" },
  { key: "cv", label: "CV", decimals: 2, unit: "%" },
  { key: "p2", label: "P2", decimals: 3, unit: "Gy" },
  { key: "p98", label: "P98", decimals: 3, unit: "Gy" },
  { key: "homogeneity_index", label: "Homogeneity (HI)", decimals: 4, unit: "" },
  { key: "dur", label: "DUR", decimals: 4, unit: "" },
  { key: "flatness", label: "Flatness", decimals: 2, unit: "%" },
  { key: "pixel_count", label: "Pixels", decimals: 0, unit: "px" },
  { key: "center_x_mm", label: "Center X", decimals: 2, unit: "mm" },
  { key: "center_y_mm", label: "Center Y", decimals: 2, unit: "mm" },
  { key: "width_mm", label: "Width", decimals: 2, unit: "mm" },
  { key: "height_mm", label: "Height", decimals: 2, unit: "mm" },
  { key: "area_mm2", label: "Area", decimals: 2, unit: "mm²" },
];

function cell(v: unknown, decimals = 4): string {
  if (typeof v !== "number" || !isFinite(v)) return "";
  return decimals === 0 ? String(Math.round(v)) : v.toFixed(decimals);
}

function escapeCsv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export interface ExportMeta {
  filmName: string | null;
  roiType: string;
  trimEnabled: boolean;
  trimPercent: number;
  cornerCutMm: number;
  threshold: number;
}

function metaLines(meta: ExportMeta): string[] {
  return [
    `# file,${escapeCsv(meta.filmName ?? "")}`,
    `# roi_type,${meta.roiType}`,
    `# trim_percent_per_tail,${meta.trimEnabled ? meta.trimPercent : 0}`,
    `# corner_cut_mm,${meta.cornerCutMm}`,
    `# threshold_gy,${meta.threshold}`,
  ];
}

/** Tab-separated table that pastes straight into a spreadsheet. */
export function statsToTSV(stats: ROIStats, meta: ExportMeta): string {
  const lines = ["metric\tvalue\tunit"];
  for (const row of STAT_ROWS) {
    lines.push(`${row.label}\t${cell(stats[row.key], row.decimals)}\t${row.unit}`);
  }
  lines.push(`Trimmed pixels\t${cell(stats.trimmed_count, 0)}\tpx`);
  lines.push(`ROI type\t${meta.roiType}\t`);
  lines.push(`Trim per tail\t${meta.trimEnabled ? meta.trimPercent : 0}\t%`);
  lines.push(`Corner cut\t${meta.cornerCutMm}\tmm`);
  lines.push(`Threshold\t${meta.threshold}\tGy`);
  return lines.join("\n");
}

export function histogramToCSV(hist: RoiHistogramData, meta: ExportMeta): string {
  const lines = [
    ...metaLines(meta),
    `# bins,${hist.bins}`,
    `# value_range_gy,${cell(hist.value_min, 6)},${cell(hist.value_max, 6)}`,
    `# total_count,${hist.total_count}`,
    "# counts include every masked pixel (no trimming)",
    "bin_start_gy,bin_end_gy,bin_center_gy,count",
  ];
  for (let i = 0; i < hist.counts.length; i++) {
    const start = hist.value_min + i * hist.bin_width;
    const end = start + hist.bin_width;
    lines.push(
      `${cell(start, 6)},${cell(end, 6)},${cell(start + hist.bin_width / 2, 6)},${hist.counts[i]}`
    );
  }
  return lines.join("\n");
}

export interface ProfileExport {
  profile: DoseProfile;
  metrics: ProfileMetrics;
}

export function profilesToCSV(
  horizontal: ProfileExport | null,
  vertical: ProfileExport | null,
  meta: ExportMeta
): string {
  const lines = [...metaLines(meta)];
  for (const [name, item] of [["horizontal", horizontal], ["vertical", vertical]] as const) {
    if (!item) continue;
    const m = item.metrics;
    lines.push(
      `# ${name}_max_gy,${cell(m.maxDose)}`,
      `# ${name}_fwhm_mm,${cell(m.fwhmMm)}`,
      `# ${name}_penumbra_left_mm,${cell(m.penumbraLeftMm)}`,
      `# ${name}_penumbra_right_mm,${cell(m.penumbraRightMm)}`
    );
  }
  lines.push("axis,position_mm,dose_gy,in_roi");
  for (const [name, item] of [["horizontal", horizontal], ["vertical", vertical]] as const) {
    if (!item) continue;
    const p = item.profile;
    for (let i = 0; i < p.dose.length; i++) {
      lines.push(`${name},${cell(p.positionMm[i])},${cell(p.dose[i])},${p.inRoi[i] ? 1 : 0}`);
    }
  }
  return lines.join("\n");
}

/** Clipboard write with a fallback for non-secure (plain http) origins. */
export async function copyText(text: string): Promise<boolean> {
  if (await copyToClipboard(text)) return true;
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export function exportFileName(filmName: string | null, suffix: string): string {
  return `${baseName(filmName || "film")}_${suffix}.csv`;
}

export function downloadCsvFile(csv: string, filmName: string | null, suffix: string): void {
  downloadCSV(csv, exportFileName(filmName, suffix));
}

/** One-line description of the active pixel-selection options, for captions. */
export function optionsCaption(stats: ROIStats | null): string | null {
  if (!stats) return null;
  const parts = [
    stats.trim_enabled ? `Trimmed ${fmt(stats.trim_percent, 1)}% per tail` : null,
    (stats.corner_cut_mm ?? 0) > 0 ? `Corners removed: ${stats.corner_cut_mm} mm` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
