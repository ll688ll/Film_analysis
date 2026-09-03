import { useMemo, useState } from "react";
import { fmt, thousands } from "./format";
import { IconCopy, toolbarButtonClass } from "./panelIcons";
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

/** The full statistics table with a copy-as-TSV action. */
export default function StatsPanel({
  stats,
  loading,
  hasError = false,
  exportMeta,
}: StatsPanelProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const rows = useMemo(() => {
    if (!stats) return null;
    return STAT_ROWS.map((row) => {
      const raw = stats[row.key];
      const num = typeof raw === "number" ? raw : null;
      let value: string;
      if (row.key === "pixel_count") {
        value = thousands(num);
        if (
          stats.trimmed_count != null &&
          num != null &&
          stats.trimmed_count !== num
        ) {
          value += ` (${thousands(stats.trimmed_count)} kept)`;
        }
      } else {
        value = fmt(num, row.decimals);
      }
      return { label: row.label, value, unit: row.unit };
    });
  }, [stats]);

  const handleCopy = async () => {
    if (!stats) return;
    const ok = await copyText(statsToTSV(stats, exportMeta));
    setCopyState(ok ? "copied" : "failed");
    window.setTimeout(() => setCopyState("idle"), 1500);
  };

  const caption = optionsCaption(stats);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs text-slate-500 truncate">
          {caption ?? (stats ? "All pixels in the ROI" : "")}
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
              {rows.map((row, i) => (
                <tr
                  key={row.label}
                  className={i % 2 === 0 ? "bg-slate-800/30" : ""}
                >
                  <td className="px-3 py-1.5 text-slate-400 font-medium">
                    {row.label}
                  </td>
                  <td className="px-3 py-1.5 text-slate-200 text-right font-mono whitespace-nowrap">
                    {row.value}
                    {row.unit && (
                      <span className="ml-1 text-slate-500">{row.unit}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
