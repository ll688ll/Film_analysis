import { useMemo, useState } from "react";
import { fmt, thousands } from "./format";
import { IconCheck, IconCopy, toolbarButtonClass } from "./panelIcons";
import {
  STAT_ROWS,
  copyText,
  optionsCaption,
  statsToTSV,
  type ExportMeta,
} from "./roiExport";
import type { ROIStats } from "./roiTypes";

export type { ROIStats } from "./roiTypes";

interface StatsPanelProps {
  stats: ROIStats | null;
  loading: boolean;
  /** The panel shows the error itself; this only suppresses the empty-state hint. */
  hasError?: boolean;
  exportMeta: ExportMeta;
}

/** How long the per-value copy tick stays on screen. */
const COPY_FEEDBACK_MS = 1200;

/** The full statistics table with a copy-as-TSV action. */
export default function StatsPanel({
  stats,
  loading,
  hasError = false,
  exportMeta,
}: StatsPanelProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [copiedRow, setCopiedRow] = useState<{
    key: string;
    ok: boolean;
  } | null>(null);

  const rows = useMemo(() => {
    if (!stats) return null;
    return STAT_ROWS.map((row) => {
      const raw = stats[row.key];
      const num = typeof raw === "number" && isFinite(raw) ? raw : null;
      let value: string;
      // Kept separate from the value so clicking copies the count alone.
      let note: string | null = null;
      if (row.key === "pixel_count") {
        value = thousands(num);
        if (
          stats.trimmed_count != null &&
          num != null &&
          stats.trimmed_count !== num
        ) {
          note = `(${thousands(stats.trimmed_count)} kept)`;
        }
      } else {
        value = fmt(num, row.decimals);
      }
      // Copy what the row shows, minus the grouping commas, so a pasted cell
      // reads as a number and matches the table it came from.
      const copy =
        num == null
          ? null
          : row.key === "pixel_count"
            ? String(num)
            : num.toFixed(row.decimals);
      return { key: row.key as string, label: row.label, copy, value, note, unit: row.unit };
    });
  }, [stats]);

  const handleCopy = async () => {
    if (!stats) return;
    const ok = await copyText(statsToTSV(stats, exportMeta));
    setCopyState(ok ? "copied" : "failed");
    window.setTimeout(() => setCopyState("idle"), 1500);
  };

  /** Copy one value at the precision the table shows -- no unit, no separators. */
  const handleCopyValue = async (key: string, copy: string | null) => {
    if (copy == null) return;
    const ok = await copyText(copy);
    setCopiedRow({ key, ok });
    window.setTimeout(
      () => setCopiedRow((c) => (c?.key === key ? null : c)),
      COPY_FEEDBACK_MS
    );
  };

  const caption = optionsCaption(stats);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs text-slate-500 truncate">
          {caption ?? (stats ? "Click a value to copy it" : "")}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          disabled={!stats}
          title="Copy the table as tab-separated text"
          className={toolbarButtonClass}
        >
          <IconCopy size={14} />
          {copyState === "copied"
            ? "Copied"
            : copyState === "failed"
              ? "Copy failed"
              : "Copy TSV"}
        </button>
      </div>

      {loading && !stats && (
        <div className="flex items-center justify-center py-6">
          <svg
            className="animate-spin h-5 w-5 text-sky-400"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <span className="ml-2 text-sm text-slate-400">Computing...</span>
        </div>
      )}

      {!loading && !stats && !hasError && (
        <p className="text-sm text-slate-500">
          Draw an ROI on the dose map to view statistics.
        </p>
      )}

      {rows && (
        <div
          className={`rounded-lg bg-slate-800/50 border border-slate-600 overflow-hidden transition-opacity ${
            loading ? "opacity-50" : ""
          }`}
        >
          <table className="w-full text-sm">
            <tbody>
              {rows.map((row, i) => {
                const copied = copiedRow?.key === row.key;
                return (
                  <tr
                    key={row.label}
                    className={i % 2 === 0 ? "bg-slate-800/30" : ""}
                  >
                    <td className="px-3 py-1.5 text-slate-400 font-medium">
                      {row.label}
                    </td>
                    <td className="px-3 py-1.5 text-slate-200 text-right font-mono whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleCopyValue(row.key, row.copy)}
                        disabled={row.copy == null}
                        title={
                          row.copy == null
                            ? undefined
                            : `Copy ${row.copy} to the clipboard`
                        }
                        aria-label={
                          row.copy == null
                            ? undefined
                            : `Copy ${row.label}: ${row.copy}`
                        }
                        className={`rounded px-1 -mx-1 transition-colors enabled:hover:bg-slate-600/70 enabled:hover:text-white enabled:cursor-pointer disabled:cursor-default ${
                          copied
                            ? copiedRow?.ok
                              ? "text-emerald-300"
                              : "text-rose-300"
                            : ""
                        }`}
                      >
                        {row.value}
                      </button>
                      {copied && (
                        <span
                          className={`ml-1 ${
                            copiedRow?.ok ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {copiedRow?.ok ? (
                            <IconCheck size={12} className="inline align-middle" />
                          ) : (
                            "failed"
                          )}
                        </span>
                      )}
                      {row.note && (
                        <span className="ml-1 text-slate-500">{row.note}</span>
                      )}
                      {row.unit && (
                        <span className="ml-1 text-slate-500">{row.unit}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="sr-only" role="status" aria-live="polite">
            {copiedRow?.ok ? "Value copied" : ""}
          </p>
        </div>
      )}
    </div>
  );
}
