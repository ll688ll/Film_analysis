import { useMemo, useState } from "react";
import { fmt, thousands } from "../../analysis/format";
import {
  STAT_ROWS,
  copyText,
  optionsCaption,
  statsToTSV,
  type ExportMeta,
} from "../../analysis/roiExport";
import type { ReportRoi } from "../reportTypes";
import { buttonClass, Caption, IconCopy, Section } from "../ui";

const COPY_FEEDBACK_MS = 1200;

/** The statistics table: the same rows as the panel, click a value to copy it. */
export default function StatsView({ roi, exportMeta }: { roi: ReportRoi; exportMeta: ExportMeta }) {
  const stats = roi.stats;
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [copiedRow, setCopiedRow] = useState<{ key: string; ok: boolean } | null>(null);

  const rows = useMemo(
    () =>
      STAT_ROWS.map((row) => {
        const raw = stats[row.key];
        const num = typeof raw === "number" && isFinite(raw) ? raw : null;
        const value = row.key === "pixel_count" ? thousands(num) : fmt(num, row.decimals);
        const note =
          row.key === "pixel_count" &&
          stats.trimmed_count != null &&
          num != null &&
          stats.trimmed_count !== num
            ? `(${thousands(stats.trimmed_count)} kept)`
            : null;
        const copy =
          num == null ? null : row.key === "pixel_count" ? String(num) : num.toFixed(row.decimals);
        return { key: row.key as string, label: row.label, value, note, unit: row.unit, copy };
      }),
    [stats]
  );

  const handleCopyAll = async () => {
    const ok = await copyText(statsToTSV(stats, exportMeta));
    setCopyState(ok ? "copied" : "failed");
    window.setTimeout(() => setCopyState("idle"), 1500);
  };

  const handleCopyValue = async (key: string, copy: string | null) => {
    if (copy == null) return;
    const ok = await copyText(copy);
    setCopiedRow({ key, ok });
    window.setTimeout(() => setCopiedRow((c) => (c?.key === key ? null : c)), COPY_FEEDBACK_MS);
  };

  const caption = optionsCaption(stats);
  const half = Math.ceil(rows.length / 2);
  const columns = [rows.slice(0, half), rows.slice(half)];

  return (
    <Section
      id="statistics"
      title="ROI statistics"
      actions={
        <button type="button" onClick={handleCopyAll} className={buttonClass} title="Copy the table as tab-separated text">
          <IconCopy />
          {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy TSV"}
        </button>
      }
    >
      <div className="grid md:grid-cols-2 gap-x-6">
        {columns.map((col, ci) => (
          <table key={ci} className="w-full text-sm">
            <tbody>
              {col.map((row, i) => {
                const copied = copiedRow?.key === row.key;
                return (
                  <tr key={row.key} className={i % 2 === 0 ? "bg-slate-50" : ""}>
                    <td className="px-3 py-1.5 text-slate-600">{row.label}</td>
                    <td className="px-3 py-1.5 text-right font-mono whitespace-nowrap text-slate-900">
                      <button
                        type="button"
                        onClick={() => handleCopyValue(row.key, row.copy)}
                        disabled={row.copy == null}
                        title={row.copy == null ? undefined : `Copy ${row.copy} to the clipboard`}
                        className={`rounded px-1 -mx-1 transition-colors enabled:hover:bg-sky-100 enabled:cursor-pointer disabled:cursor-default ${
                          copied ? (copiedRow?.ok ? "text-emerald-700" : "text-rose-700") : ""
                        }`}
                      >
                        {row.value}
                      </button>
                      {copied && (
                        <span className={`ml-1 text-xs ${copiedRow?.ok ? "text-emerald-600" : "text-rose-600"}`}>
                          {copiedRow?.ok ? "✓" : "failed"}
                        </span>
                      )}
                      {row.note && <span className="ml-1 text-xs text-slate-500">{row.note}</span>}
                      {row.unit && <span className="ml-1 text-xs text-slate-500">{row.unit}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ))}
      </div>
      <Caption>
        {caption ? `${caption}. ` : ""}
        {roi.threshold > 0 ? `Pixels at or below ${roi.threshold} Gy were excluded. ` : ""}
        Click a value to copy it without its unit.
      </Caption>
    </Section>
  );
}
