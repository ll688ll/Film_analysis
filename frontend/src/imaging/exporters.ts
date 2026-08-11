/**
 * Client-side exports. Everything needed is already in the browser -- the
 * numbers, the colours, and the labels -- so there is no export endpoint.
 */

import type { AnalyzeResponse, Level, LevelStat } from "./types";

function cell(v: number | null | undefined, decimals = 4): string {
  if (v == null || !isFinite(v)) return "";
  return v.toFixed(decimals);
}

const HEADERS = [
  "level", "label", "color",
  "range_min", "range_max",
  "mean", "std", "min", "max",
  "count", "count_pct", "area",
];

function rows(
  levels: Level[],
  stats: LevelStat[],
  hist: AnalyzeResponse
): string[][] {
  const areaPerPixel = hist.has_dpi ? (25.4 / hist.dpi) ** 2 : 1;
  return levels.map((level, i) => {
    const s = stats[i];
    const e = s?.exact;
    return [
      String(level.index + 1),
      level.label,
      level.color,
      cell(s?.lower),
      cell(s?.upper),
      cell(e ? e.mean : s?.mean),
      cell(e ? e.std : s?.std),
      cell(e ? e.min : s?.minApprox),
      cell(e ? e.max : s?.maxApprox),
      String(s?.count ?? 0),
      cell(s?.countPct, 4),
      cell((s?.count ?? 0) * areaPerPixel, hist.has_dpi ? 4 : 0),
    ];
  });
}

function escapeCsv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function levelsToCSV(
  levels: Level[],
  stats: LevelStat[],
  hist: AnalyzeResponse,
  filename: string
): string {
  const areaUnit = hist.has_dpi ? "mm2" : "px2";
  const meta = [
    `# file,${escapeCsv(filename)}`,
    `# source,${hist.source}`,
    `# bins,${hist.bins}`,
    `# value_window,${hist.value_min},${hist.value_max}`,
    `# analysed_px,${hist.total_count}`,
    `# total_px,${hist.total_pixels}`,
    `# excluded_nonfinite,${hist.excluded_nonfinite}`,
    `# excluded_below_window,${hist.excluded_low}`,
    `# excluded_above_window,${hist.excluded_high}`,
    `# area_unit,${areaUnit}`,
    hist.has_dpi ? `# dpi,${hist.dpi}` : "# dpi,none (area in pixels)",
    `# overall_mean,${cell(hist.overall.mean)}`,
    `# overall_std,${cell(hist.overall.std)}`,
    "# count_pct is of analysed pixels",
  ];

  const body = rows(levels, stats, hist).map((r) => r.map(escapeCsv).join(","));
  return [...meta, HEADERS.join(","), ...body].join("\n");
}

export function levelsToTSV(
  levels: Level[],
  stats: LevelStat[],
  hist: AnalyzeResponse
): string {
  const body = rows(levels, stats, hist).map((r) => r.join("\t"));
  return [HEADERS.join("\t"), ...body].join("\n");
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadCSV(csv: string, filename: string): void {
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), filename);
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function exportCanvasPNG(
  canvas: HTMLCanvasElement | null,
  filename: string
): void {
  if (!canvas) return;
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, filename);
  }, "image/png");
}

/** Strip the extension so exports sit next to the source file by name. */
export function baseName(filename: string): string {
  return filename.replace(/\.[^./\\]+$/, "") || "image";
}
