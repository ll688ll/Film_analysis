import { COLOR_PRESETS } from "./levelColors";
import type { Level, LevelStat } from "./types";

interface IntensityPaletteProps {
  levels: Level[];
  stats: LevelStat[];
  preset: string;
  reverse: boolean;
  onPresetChange: (preset: string) => void;
  onReverseChange: (reverse: boolean) => void;
  onLevelColorChange: (index: number, color: string) => void;
  onIsolate: (index: number | null) => void;
  disabled: boolean;
}

function fmt(v: number | null | undefined, decimals = 1): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toFixed(decimals);
}

/**
 * The swatch strip: one colour box per level, plus a preset selector.
 * Each swatch is a label wrapping a hidden colour input so the whole box is
 * the hit target.
 */
export default function IntensityPalette({
  levels,
  stats,
  preset,
  reverse,
  onPresetChange,
  onReverseChange,
  onLevelColorChange,
  onIsolate,
  disabled,
}: IntensityPaletteProps) {
  return (
    <div className="p-4 border-b border-slate-600">
      <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
        Intensity
      </h2>

      <div className="flex gap-2 mb-3">
        <select
          value={preset}
          disabled={disabled}
          onChange={(e) => onPresetChange(e.target.value)}
          className="flex-1 px-2 py-1.5 text-xs bg-slate-800 border border-slate-600 rounded text-slate-200 disabled:opacity-50"
        >
          {COLOR_PRESETS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onReverseChange(!reverse)}
          title="Reverse the colour order"
          className={`px-2.5 py-1.5 text-xs font-medium rounded border transition-colors disabled:opacity-50 ${
            reverse
              ? "bg-sky-600 border-sky-500 text-white"
              : "bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-600"
          }`}
        >
          Reverse
        </button>
      </div>

      <div className="flex gap-1" onMouseLeave={() => onIsolate(null)}>
        {levels.map((level) => {
          const stat = stats[level.index];
          const title = [
            level.label,
            `${fmt(stat?.lower)}–${fmt(stat?.upper)}`,
            `${fmt(stat?.countPct, 2)}%`,
          ].join(" · ");

          return (
            <label
              key={level.index}
              title={title}
              onMouseEnter={() => onIsolate(level.index)}
              className={`relative flex-1 h-9 rounded border border-slate-500 overflow-hidden ${
                disabled ? "opacity-50" : "cursor-pointer hover:ring-2 hover:ring-sky-400"
              } ${level.visible ? "" : "opacity-30"}`}
              style={{ backgroundColor: level.color }}
            >
              <input
                type="color"
                value={level.color}
                disabled={disabled}
                onChange={(e) => onLevelColorChange(level.index, e.target.value)}
                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer disabled:cursor-not-allowed"
              />
            </label>
          );
        })}
      </div>

      <p className="mt-2 text-xs text-slate-500">
        Click a swatch to recolour that level. Hover to isolate it on the image.
      </p>
    </div>
  );
}
