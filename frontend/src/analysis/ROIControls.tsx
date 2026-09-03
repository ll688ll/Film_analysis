import type { ROIType } from "./roiTypes";

export type { ROIType } from "./roiTypes";

interface ROIControlsProps {
  roiType: ROIType;
  rotation: number;
  holeRatio: number;
  threshold: number;
  trimEnabled: boolean;
  trimPercent: number;
  cornerCutEnabled: boolean;
  cornerCutMm: number;
  onROITypeChange: (type: ROIType) => void;
  onRotationChange: (deg: number) => void;
  onHoleRatioChange: (ratio: number) => void;
  onThresholdChange: (val: number) => void;
  onTrimEnabledChange: (enabled: boolean) => void;
  onTrimPercentChange: (pct: number) => void;
  onCornerCutEnabledChange: (enabled: boolean) => void;
  onCornerCutMmChange: (mm: number) => void;
  onCalculate: () => void;
  disabled: boolean;
}

const roiTypes: ROIType[] = ["Rectangle", "Circle", "Ring"];

const numberCls =
  "w-16 px-2 py-1 text-xs bg-slate-800 border border-slate-600 rounded text-slate-200 text-right disabled:opacity-50";
const rowLabelCls = "w-24 flex-none text-xs text-slate-400";
const hintCls = "flex-1 text-right text-xs text-slate-500";
const unitCls = "w-6 flex-none text-xs text-slate-500";

/**
 * ROI shape and pixel-selection options. Rendered inside a section of the
 * ROI panel, so it brings its own padding but no heading.
 */
export default function ROIControls({
  roiType,
  rotation,
  holeRatio,
  threshold,
  trimEnabled,
  trimPercent,
  cornerCutEnabled,
  cornerCutMm,
  onROITypeChange,
  onRotationChange,
  onHoleRatioChange,
  onThresholdChange,
  onTrimEnabledChange,
  onTrimPercentChange,
  onCornerCutEnabledChange,
  onCornerCutMmChange,
  onCalculate,
  disabled,
}: ROIControlsProps) {
  return (
    <div className="p-4 space-y-2.5">
      {/* ROI type selector */}
      <div className="flex rounded-lg overflow-hidden border border-slate-600">
        {roiTypes.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onROITypeChange(t)}
            disabled={disabled}
            className={`flex-1 px-2 py-1.5 text-xs font-medium transition-colors ${
              roiType === t
                ? "bg-sky-600 text-white"
                : "bg-slate-700 text-slate-300 hover:bg-slate-600"
            } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Rotation (Rectangle only) */}
      {roiType === "Rectangle" && (
        <div className="flex items-center gap-2">
          <span className={rowLabelCls}>Rotation</span>
          <input
            type="range"
            min={0}
            max={360}
            value={rotation}
            onChange={(e) => onRotationChange(Number(e.target.value))}
            disabled={disabled}
            className="flex-1 min-w-0 accent-sky-500 disabled:opacity-50"
            title="Rotate the rectangle about its centre"
          />
          <input
            type="number"
            min={0}
            max={360}
            value={rotation}
            onChange={(e) =>
              onRotationChange(
                Math.max(0, Math.min(360, Number(e.target.value)))
              )
            }
            disabled={disabled}
            className={numberCls}
          />
          <span className={unitCls}>°</span>
        </div>
      )}

      {/* Hole ratio (Ring only) */}
      {roiType === "Ring" && (
        <div className="flex items-center gap-2">
          <span className={rowLabelCls}>Hole ratio</span>
          <input
            type="range"
            min={10}
            max={90}
            value={holeRatio}
            onChange={(e) => onHoleRatioChange(Number(e.target.value))}
            disabled={disabled}
            className="flex-1 min-w-0 accent-sky-500 disabled:opacity-50"
          />
          <input
            type="number"
            min={10}
            max={90}
            value={holeRatio}
            onChange={(e) =>
              onHoleRatioChange(
                Math.max(10, Math.min(90, Number(e.target.value)))
              )
            }
            disabled={disabled}
            className={numberCls}
          />
          <span className={unitCls}>%</span>
        </div>
      )}

      {/* Corner removal (Rectangle only) */}
      {roiType === "Rectangle" && (
        <div className="flex items-center gap-2">
          <label className={`${rowLabelCls} flex items-center gap-2 cursor-pointer`}>
            <input
              type="checkbox"
              checked={cornerCutEnabled}
              onChange={(e) => onCornerCutEnabledChange(e.target.checked)}
              disabled={disabled}
              className="accent-sky-500"
            />
            Remove corners
          </label>
          <span className={hintCls}>corner length</span>
          <input
            type="number"
            min={0}
            step={0.5}
            value={cornerCutMm}
            onChange={(e) =>
              onCornerCutMmChange(Math.max(0, Number(e.target.value)))
            }
            disabled={disabled || !cornerCutEnabled}
            className={numberCls}
          />
          <span className={unitCls}>mm</span>
        </div>
      )}

      {/* Remove max/min (trim) */}
      <div className="flex items-center gap-2">
        <label className={`${rowLabelCls} flex items-center gap-2 cursor-pointer`}>
          <input
            type="checkbox"
            checked={trimEnabled}
            onChange={(e) => onTrimEnabledChange(e.target.checked)}
            disabled={disabled}
            className="accent-sky-500"
          />
          Trim max/min
        </label>
        <span className={hintCls}>per tail</span>
        <input
          type="number"
          min={0}
          max={49}
          step={0.5}
          value={trimPercent}
          onChange={(e) =>
            onTrimPercentChange(
              Math.max(0, Math.min(49, Number(e.target.value)))
            )
          }
          disabled={disabled || !trimEnabled}
          className={numberCls}
        />
        <span className={unitCls}>%</span>
      </div>

      {/* Threshold */}
      <div className="flex items-center gap-2">
        <span className={rowLabelCls}>Threshold</span>
        <span className={hintCls}>exclude dose ≤</span>
        <input
          type="number"
          step="0.01"
          min={0}
          value={threshold}
          onChange={(e) => onThresholdChange(Number(e.target.value))}
          disabled={disabled}
          className={numberCls}
        />
        <span className={unitCls}>Gy</span>
      </div>

      {/* Recalculate (statistics also refresh automatically on every change) */}
      <button
        type="button"
        onClick={onCalculate}
        disabled={disabled}
        className={`w-full mt-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
          disabled
            ? "bg-slate-600 text-slate-400 cursor-not-allowed"
            : "bg-emerald-600 hover:bg-emerald-500 text-white"
        }`}
      >
        Recalculate
      </button>
    </div>
  );
}
