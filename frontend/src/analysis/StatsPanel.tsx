import { useMemo } from "react";

export interface ROIStats {
  max: number;
  min: number;
  mean: number;
  std: number;
  cv: number;
  dur: number;
  flatness: number;
  center_x_mm: number;
  center_y_mm: number;
  width_mm: number;
  height_mm: number;
  area_mm2: number;
}

interface StatsPanelProps {
  stats: ROIStats | null;
  loading: boolean;
}

function fmt(v: number | undefined | null, decimals = 3): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toFixed(decimals);
}

export default function StatsPanel({ stats, loading }: StatsPanelProps) {
  const rows = useMemo(() => {
    if (!stats) return null;
    return [
      { label: "Dose Max", value: `${fmt(stats.max)} Gy` },
      { label: "Dose Min", value: `${fmt(stats.min)} Gy` },
      { label: "Dose Mean", value: `${fmt(stats.mean)} Gy` },
      { label: "Dose Std", value: `${fmt(stats.std)} Gy` },
      { label: "CV", value: `${fmt(stats.cv, 2)} %` },
      { label: "DUR", value: fmt(stats.dur, 4) },
      { label: "Flatness", value: `${fmt(stats.flatness, 2)} %` },
      { label: "Center X", value: `${fmt(stats.center_x_mm, 2)} mm` },
      { label: "Center Y", value: `${fmt(stats.center_y_mm, 2)} mm` },
      { label: "Width", value: `${fmt(stats.width_mm, 2)} mm` },
      { label: "Height", value: `${fmt(stats.height_mm, 2)} mm` },
      { label: "Area", value: `${fmt(stats.area_mm2, 2)} mm\u00B2` },
    ];
  }, [stats]);

  return (
    <div className="p-4">
      <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
        Statistics
      </h2>

      {loading && (
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

      {!loading && !stats && (
        <p className="text-sm text-slate-500">
          Draw an ROI on the dose map to view statistics.
        </p>
      )}

      {!loading && rows && (
        <div className="rounded-lg bg-slate-800/50 border border-slate-600 overflow-hidden">
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
                  <td className="px-3 py-1.5 text-slate-200 text-right font-mono">
                    {row.value}
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
