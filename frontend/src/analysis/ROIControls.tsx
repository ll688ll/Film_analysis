export type ROIType = "Rectangle" | "Circle" | "Ring";

interface ROIControlsProps {
  roiType: ROIType;
  rotation: number;
  holeRatio: number;
  threshold: number;
  onROITypeChange: (type: ROIType) => void;
  onRotationChange: (deg: number) => void;
  onHoleRatioChange: (ratio: number) => void;
  onThresholdChange: (val: number) => void;
  onCalculate: () => void;
  disabled: boolean;
}

const roiTypes: ROIType[] = ["Rectangle", "Circle", "Ring"];

export default function ROIControls({
  roiType,
  rotation,
  holeRatio,
  threshold,
  onROITypeChange,
  onRotationChange,
  onHoleRatioChange,
  onThresholdChange,
  onCalculate,
  disabled,
}: ROIControlsProps) {
  return (
    <div className="p-4 border-b border-slate-600">
      <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
        ROI Tools
      </h2>

      {/* ROI type selector */}
      <div className="flex rounded-lg overflow-hidden border border-slate-600 mb-4">
        {roiTypes.map((t) => (
          <button
            key={t}
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
        <div className="mb-3">
          <label className="block text-xs text-slate-400 mb-1">
            Rotation: {rotation}\u00B0
          </label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={360}
              value={rotation}
              onChange={(e) => onRotationChange(Number(e.target.value))}
              disabled={disabled}
              className="flex-1 accent-sky-500"
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
              className="w-16 px-2 py-1 text-xs bg-slate-800 border border-slate-600 rounded text-slate-200 text-right"
            />
          </div>
        </div>
      )}

      {/* Hole ratio (Ring only) */}
      {roiType === "Ring" && (
        <div className="mb-3">
          <label className="block text-xs text-slate-400 mb-1">
            Hole Ratio: {holeRatio}%
          </label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={10}
              max={90}
              value={holeRatio}
              onChange={(e) => onHoleRatioChange(Number(e.target.value))}
              disabled={disabled}
              className="flex-1 accent-sky-500"
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
              className="w-16 px-2 py-1 text-xs bg-slate-800 border border-slate-600 rounded text-slate-200 text-right"
            />
          </div>
        </div>
      )}

      {/* Threshold */}
      <div className="mb-4">
        <label className="block text-xs text-slate-400 mb-1">
          Threshold (Gy)
        </label>
        <input
          type="number"
          step="0.01"
          min={0}
          value={threshold}
          onChange={(e) => onThresholdChange(Number(e.target.value))}
          disabled={disabled}
          className="w-full px-2 py-1.5 text-sm bg-slate-800 border border-slate-600 rounded text-slate-200"
        />
      </div>

      {/* Calculate button */}
      <button
        onClick={onCalculate}
        disabled={disabled}
        className={`w-full px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
          disabled
            ? "bg-slate-600 text-slate-400 cursor-not-allowed"
            : "bg-emerald-600 hover:bg-emerald-500 text-white"
        }`}
      >
        Calculate ROI Stats
      </button>
    </div>
  );
}
