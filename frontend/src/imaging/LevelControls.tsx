import {
  BINNING_METHOD_LABELS,
  INTENSITY_SOURCES,
  type AnalyzeResponse,
  type BinningMethod,
  type IntensitySource,
} from "./types";

interface LevelControlsProps {
  source: IntensitySource;
  onSourceChange: (s: IntensitySource) => void;
  channels: number;
  levelCount: number;
  onLevelCountChange: (n: number) => void;
  method: BinningMethod;
  onMethodChange: (m: BinningMethod) => void;
  bins: number;
  onBinsChange: (b: number) => void;
  valueMin: number | null;
  valueMax: number | null;
  onWindowChange: (min: number | null, max: number | null) => void;
  excludeZero: boolean;
  onExcludeZeroChange: (v: boolean) => void;
  ignoreTransparent: boolean;
  onIgnoreTransparentChange: (v: boolean) => void;
  hasAlpha: boolean;
  maxPossible: number | null;
  hist: AnalyzeResponse | null;
  disabled: boolean;
}

const MAX_LEVELS = 16;
const BIN_CHOICES = [64, 128, 256, 512, 1024];
const AUTO_METHODS: BinningMethod[] = ["equal_width", "equal_count", "otsu", "kmeans"];

export default function LevelControls({
  source,
  onSourceChange,
  channels,
  levelCount,
  onLevelCountChange,
  method,
  onMethodChange,
  bins,
  onBinsChange,
  valueMin,
  valueMax,
  onWindowChange,
  excludeZero,
  onExcludeZeroChange,
  ignoreTransparent,
  onIgnoreTransparentChange,
  hasAlpha,
  maxPossible,
  hist,
  disabled,
}: LevelControlsProps) {
  const colorAvailable = channels >= 3;
  const windowed = valueMin !== null || valueMax !== null;

  const segBtn = (active: boolean, isDisabled = false) =>
    `flex-1 px-2 py-1.5 text-xs font-medium transition-colors ${
      isDisabled
        ? "bg-slate-800 text-slate-600 cursor-not-allowed"
        : active
        ? "bg-sky-600 text-white"
        : "bg-slate-800 text-slate-300 hover:bg-slate-600"
    }`;

  return (
    <div className="p-4 border-b border-slate-600 space-y-4">
      <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
        Intensity Levels
      </h2>

      {/* Source */}
      <div>
        <label className="block text-xs text-slate-400 mb-1.5">Source</label>
        <div className="flex rounded-md overflow-hidden border border-slate-600">
          {INTENSITY_SOURCES.map((s) => {
            const unavailable = !colorAvailable && s !== "Gray" && s !== "Mean";
            return (
              <button
                key={s}
                type="button"
                disabled={disabled || unavailable}
                title={unavailable ? "Image has no colour channels" : undefined}
                onClick={() => onSourceChange(s)}
                className={segBtn(source === s, disabled || unavailable)}
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>

      {/* Level count */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs text-slate-400">Number of levels</label>
          <input
            type="number"
            min={2}
            max={MAX_LEVELS}
            value={levelCount}
            disabled={disabled}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!Number.isNaN(n)) {
                onLevelCountChange(Math.max(2, Math.min(MAX_LEVELS, n)));
              }
            }}
            className="w-16 px-2 py-1 text-xs bg-slate-800 border border-slate-600 rounded text-slate-200 text-right disabled:opacity-50"
          />
        </div>
        <input
          type="range"
          min={2}
          max={MAX_LEVELS}
          value={levelCount}
          disabled={disabled}
          onChange={(e) => onLevelCountChange(parseInt(e.target.value, 10))}
          className="w-full accent-sky-500 disabled:opacity-50"
        />
      </div>

      {/* Method */}
      <div>
        <label className="block text-xs text-slate-400 mb-1.5">
          Level boundaries
        </label>
        <div className="grid grid-cols-2 gap-1">
          {AUTO_METHODS.map((m) => (
            <button
              key={m}
              type="button"
              disabled={disabled}
              onClick={() => onMethodChange(m)}
              className={`px-2 py-1.5 text-xs font-medium rounded border transition-colors ${
                method === m
                  ? "bg-sky-600 border-sky-500 text-white"
                  : "bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-600"
              } disabled:opacity-50`}
            >
              {BINNING_METHOD_LABELS[m]}
            </button>
          ))}
        </div>
        {method === "manual" && (
          <p className="mt-1.5 text-xs text-amber-400/80">
            Manual — boundaries edited by hand. Pick a method above to recompute.
          </p>
        )}
        {method === "equal_count" && (
          <p className="mt-1.5 text-xs text-slate-500">
            Exact equal counts are impossible when the histogram has spikes; the
            Count % column shows what was actually achieved.
          </p>
        )}
      </div>

      {/* Histogram resolution */}
      <div>
        <label className="block text-xs text-slate-400 mb-1.5">
          Histogram bins
        </label>
        <select
          value={bins}
          disabled={disabled}
          onChange={(e) => onBinsChange(parseInt(e.target.value, 10))}
          className="w-full px-2 py-1.5 text-xs bg-slate-800 border border-slate-600 rounded text-slate-200 disabled:opacity-50"
        >
          {BIN_CHOICES.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-500">
          Boundaries snap to bin edges, which keeps the statistics exact.
        </p>
      </div>

      {/* Value window */}
      <div>
        <label className="block text-xs text-slate-400 mb-1.5">Value window</label>
        <div className="flex gap-2">
          <input
            type="number"
            placeholder="min"
            value={valueMin ?? ""}
            disabled={disabled}
            onChange={(e) =>
              onWindowChange(
                e.target.value === "" ? null : Number(e.target.value),
                valueMax
              )
            }
            className="w-1/2 px-2 py-1 text-xs bg-slate-800 border border-slate-600 rounded text-slate-200 disabled:opacity-50"
          />
          <input
            type="number"
            placeholder="max"
            value={valueMax ?? ""}
            disabled={disabled}
            onChange={(e) =>
              onWindowChange(
                valueMin,
                e.target.value === "" ? null : Number(e.target.value)
              )
            }
            className="w-1/2 px-2 py-1 text-xs bg-slate-800 border border-slate-600 rounded text-slate-200 disabled:opacity-50"
          />
        </div>
        <div className="flex gap-2 mt-1.5">
          <button
            type="button"
            disabled={disabled || maxPossible === null}
            onClick={() => onWindowChange(0, maxPossible)}
            title="Compare intensities across images on the same absolute scale"
            className="flex-1 px-2 py-1 text-xs bg-slate-800 border border-slate-600 rounded text-slate-300 hover:bg-slate-600 disabled:opacity-50"
          >
            Full depth
          </button>
          <button
            type="button"
            disabled={disabled || !hist?.overall.p1}
            onClick={() =>
              hist && onWindowChange(hist.overall.p1, hist.overall.p99)
            }
            className="flex-1 px-2 py-1 text-xs bg-slate-800 border border-slate-600 rounded text-slate-300 hover:bg-slate-600 disabled:opacity-50"
          >
            Auto (1–99%)
          </button>
          <button
            type="button"
            disabled={disabled || !windowed}
            onClick={() => onWindowChange(null, null)}
            title="Clear the window and analyse the full data range"
            className="flex-1 px-2 py-1 text-xs bg-slate-800 border border-slate-600 rounded text-slate-300 hover:bg-slate-600 disabled:opacity-50"
          >
            Clear
          </button>
        </div>
        {hist && (hist.excluded_low > 0 || hist.excluded_high > 0) && (
          <p className="mt-1.5 text-xs text-amber-400/80">
            {(hist.excluded_low + hist.excluded_high).toLocaleString()} px outside
            the window are excluded from every statistic.
          </p>
        )}
      </div>

      {/* Pixel exclusions */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={excludeZero}
            disabled={disabled}
            onChange={(e) => onExcludeZeroChange(e.target.checked)}
            className="accent-sky-500"
          />
          Exclude zero-valued pixels
        </label>
        <label
          className={`flex items-center gap-2 text-xs cursor-pointer ${
            hasAlpha ? "text-slate-300" : "text-slate-600 cursor-not-allowed"
          }`}
          title={hasAlpha ? undefined : "Image has no alpha channel"}
        >
          <input
            type="checkbox"
            checked={ignoreTransparent}
            disabled={disabled || !hasAlpha}
            onChange={(e) => onIgnoreTransparentChange(e.target.checked)}
            className="accent-sky-500"
          />
          Ignore transparent pixels
        </label>
      </div>
    </div>
  );
}
