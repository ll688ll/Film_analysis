import { useState } from "react";
import type { AnalyzeResponse, Level, LevelStat } from "./types";

interface LevelTableProps {
  levels: Level[];
  stats: LevelStat[];
  hist: AnalyzeResponse | null;
  loading: boolean;
  exactLoading: boolean;
  onToggleVisible: (index: number) => void;
  onIsolate: (index: number | null) => void;
  onRequestExact: () => void;
  onExportCsv: () => void;
  onCopyTsv: () => void;
}

/** Em dash for absent or non-finite values, matching analysis/StatsPanel. */
function fmt(v: number | null | undefined, decimals = 2): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toFixed(decimals);
}

function fmtInt(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  return Math.round(v).toLocaleString();
}

export default function LevelTable({
  levels,
  stats,
  hist,
  loading,
  exactLoading,
  onToggleVisible,
  onIsolate,
  onRequestExact,
  onExportCsv,
  onCopyTsv,
}: LevelTableProps) {
  const [showMore, setShowMore] = useState(false);

  const analysed = hist?.total_count ?? 0;
  const totalPixels = hist?.total_pixels ?? 0;
  const pctAnalysed = totalPixels > 0 ? (analysed / totalPixels) * 100 : 0;

  // A general image has no physical scale unless the file declares a DPI.
  const areaUnit = hist?.has_dpi ? "mm²" : "px²";
  const mmPerPx = hist?.has_dpi ? 25.4 / hist.dpi : 1;
  const areaPerPixel = hist?.has_dpi ? mmPerPx * mmPerPx : 1;

  return (
    <div className="p-4 border-b border-slate-600">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Statistics
        </h2>
        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          className="text-xs text-sky-400 hover:text-sky-300"
        >
          {showMore ? "Less" : "More"}
        </button>
      </div>

      {loading && (
        <div className="flex items-center py-6">
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
          <span className="ml-2 text-sm text-slate-400">Analysing…</span>
        </div>
      )}

      {!loading && !hist && (
        <p className="text-sm text-slate-500">
          Upload an image to see per-level statistics.
        </p>
      )}

      {!loading && hist && (
        <>
          {/* Disclose the denominator: Count % is of analysed pixels. */}
          <p className="text-xs text-slate-500 mb-2">
            Analysed {analysed.toLocaleString()} of {totalPixels.toLocaleString()} px
            ({pctAnalysed.toFixed(1)}%)
          </p>

          <div className="rounded-lg bg-slate-800/50 border border-slate-600 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-400 border-b border-slate-600">
                  <th className="px-2 py-1.5 text-left font-medium w-8"></th>
                  <th className="px-2 py-1.5 text-left font-medium">Level</th>
                  <th className="px-2 py-1.5 text-right font-medium">Range</th>
                  <th className="px-2 py-1.5 text-right font-medium">Mean</th>
                  <th className="px-2 py-1.5 text-right font-medium">Count</th>
                  <th className="px-2 py-1.5 text-right font-medium">%</th>
                  {showMore && (
                    <>
                      <th className="px-2 py-1.5 text-right font-medium">Std</th>
                      <th className="px-2 py-1.5 text-right font-medium">Min</th>
                      <th className="px-2 py-1.5 text-right font-medium">Max</th>
                      <th
                        className="px-2 py-1.5 text-right font-medium"
                        title={
                          hist.has_dpi
                            ? `Using ${hist.dpi.toFixed(0)} DPI from the file`
                            : "No DPI in the file — area is reported in pixels"
                        }
                      >
                        Area ({areaUnit})
                      </th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody onMouseLeave={() => onIsolate(null)}>
                {levels.map((level, i) => {
                  const s = stats[i];
                  const exact = s?.exact;
                  return (
                    <tr
                      key={level.index}
                      onMouseEnter={() => onIsolate(level.index)}
                      className={`${i % 2 === 0 ? "bg-slate-800/30" : ""} ${
                        level.visible ? "" : "opacity-40"
                      } hover:bg-slate-700/50`}
                    >
                      <td className="px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => onToggleVisible(level.index)}
                          title={level.visible ? "Hide this level" : "Show this level"}
                          className="w-4 h-4 rounded-sm border border-slate-500 block"
                          style={{ backgroundColor: level.color }}
                        />
                      </td>
                      <td className="px-2 py-1.5 text-slate-300">{level.label}</td>
                      <td className="px-2 py-1.5 text-right text-slate-400 font-mono whitespace-nowrap">
                        {fmt(s?.lower, 1)}–{fmt(s?.upper, 1)}
                      </td>
                      <td className="px-2 py-1.5 text-right text-slate-200 font-mono">
                        {fmt(exact ? exact.mean : s?.mean)}
                      </td>
                      <td className="px-2 py-1.5 text-right text-slate-200 font-mono">
                        {fmtInt(s?.count)}
                      </td>
                      <td className="px-2 py-1.5 text-right text-slate-200 font-mono">
                        {fmt(s?.countPct)}
                      </td>
                      {showMore && (
                        <>
                          <td className="px-2 py-1.5 text-right text-slate-300 font-mono">
                            {fmt(exact ? exact.std : s?.std)}
                          </td>
                          <td className="px-2 py-1.5 text-right text-slate-300 font-mono">
                            {fmt(exact ? exact.min : s?.minApprox)}
                          </td>
                          <td className="px-2 py-1.5 text-right text-slate-300 font-mono">
                            {fmt(exact ? exact.max : s?.maxApprox)}
                          </td>
                          <td className="px-2 py-1.5 text-right text-slate-300 font-mono">
                            {fmt((s?.count ?? 0) * areaPerPixel, hist.has_dpi ? 2 : 0)}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {showMore && !stats.some((s) => s.exact) && (
            <p className="mt-2 text-xs text-slate-500">
              Min/Max are the bounds of the first and last populated bin. Use
              “Exact” for true per-level extremes.
            </p>
          )}

          {hist.overall.mean !== null && (
            <div className="mt-3 rounded-lg bg-slate-800/50 border border-slate-600 px-3 py-2 text-xs">
              <div className="text-slate-400 mb-1 font-medium">Whole image</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-slate-300">
                <span className="text-slate-500">Mean</span>
                <span className="text-right">{fmt(hist.overall.mean, 3)}</span>
                <span className="text-slate-500">Std</span>
                <span className="text-right">{fmt(hist.overall.std, 3)}</span>
                <span className="text-slate-500">Median</span>
                <span className="text-right">{fmt(hist.overall.median, 3)}</span>
                <span className="text-slate-500">Min / Max</span>
                <span className="text-right">
                  {fmt(hist.overall.min, 1)} / {fmt(hist.overall.max, 1)}
                </span>
              </div>
            </div>
          )}

          {hist.excluded_nonfinite > 0 && (
            <p className="mt-2 text-xs text-amber-400/80">
              {hist.excluded_nonfinite.toLocaleString()} non-finite px excluded.
            </p>
          )}

          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={onRequestExact}
              disabled={exactLoading}
              title="Recompute from full-resolution pixels on the server"
              className="flex-1 px-2 py-1.5 text-xs bg-slate-800 border border-slate-600 rounded text-slate-300 hover:bg-slate-600 disabled:opacity-50"
            >
              {exactLoading ? "Computing…" : "Exact"}
            </button>
            <button
              type="button"
              onClick={onCopyTsv}
              className="flex-1 px-2 py-1.5 text-xs bg-slate-800 border border-slate-600 rounded text-slate-300 hover:bg-slate-600"
            >
              Copy
            </button>
            <button
              type="button"
              onClick={onExportCsv}
              className="flex-1 px-2 py-1.5 text-xs bg-sky-600 border border-sky-500 rounded text-white hover:bg-sky-500"
            >
              CSV
            </button>
          </div>
        </>
      )}
    </div>
  );
}
