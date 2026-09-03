import { fmt } from "./format";
import type { ROIStats } from "./roiTypes";

interface SummaryTilesProps {
  stats: ROIStats | null;
  loading: boolean;
}

/** The four numbers worth seeing on every tab. */
export default function SummaryTiles({ stats, loading }: SummaryTilesProps) {
  const tiles = [
    { label: "Mean", value: fmt(stats?.mean), unit: "Gy" },
    { label: "Std", value: fmt(stats?.std), unit: "Gy" },
    { label: "CV", value: fmt(stats?.cv, 2), unit: "%" },
    { label: "Max", value: fmt(stats?.max), unit: "Gy" },
  ];
  return (
    <div
      className={`px-4 pt-3 grid grid-cols-4 gap-2 transition-opacity ${
        loading ? "opacity-50" : ""
      }`}
    >
      {tiles.map((t) => (
        <div
          key={t.label}
          className="min-w-0 rounded-lg bg-slate-800/50 border border-slate-600 px-2.5 py-2"
        >
          <div className="text-[10px] leading-3 uppercase tracking-wider text-slate-400">
            {t.label}
          </div>
          <div className="mt-1 text-sm font-semibold font-mono text-slate-100 truncate">
            {t.value}
          </div>
          <div className="text-[10px] leading-3 text-slate-500">{t.unit}</div>
        </div>
      ))}
    </div>
  );
}
