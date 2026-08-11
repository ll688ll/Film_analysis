interface ImageToolbarProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  overlayOpacity: number;
  onOverlayOpacityChange: (v: number) => void;
  roiEnabled: boolean;
  onRoiEnabledChange: (v: boolean) => void;
  hasRoi: boolean;
  onClearRoi: () => void;
  onExportPng: () => void;
  downsample: number;
  disabled: boolean;
}

const btn =
  "px-2 py-1 text-xs bg-slate-800/90 border border-slate-600 rounded text-slate-200 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800/90";

export default function ImageToolbar({
  zoom,
  onZoomIn,
  onZoomOut,
  onFit,
  overlayOpacity,
  onOverlayOpacityChange,
  roiEnabled,
  onRoiEnabledChange,
  hasRoi,
  onClearRoi,
  onExportPng,
  downsample,
  disabled,
}: ImageToolbarProps) {
  return (
    <div className="absolute bottom-3 left-3 flex flex-col gap-2 items-start">
      {downsample > 1 && (
        <div className="px-2 py-1 rounded bg-amber-900/70 border border-amber-700/60 text-[11px] text-amber-200">
          Display downsampled {downsample}× · statistics use full resolution
        </div>
      )}

      <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-slate-900/80 backdrop-blur border border-slate-700">
        <button type="button" className={btn} onClick={onZoomOut} disabled={disabled}>
          −
        </button>
        <span className="text-xs text-slate-300 font-mono w-12 text-center">
          {(zoom * 100).toFixed(0)}%
        </span>
        <button type="button" className={btn} onClick={onZoomIn} disabled={disabled}>
          +
        </button>
        <button type="button" className={btn} onClick={onFit} disabled={disabled}>
          Fit
        </button>

        <div className="w-px h-5 bg-slate-700" />

        <label className="flex items-center gap-1.5 text-xs text-slate-300">
          Overlay
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(overlayOpacity * 100)}
            disabled={disabled}
            onChange={(e) => onOverlayOpacityChange(Number(e.target.value) / 100)}
            className="w-24 accent-sky-500"
            title="Blend between the original image and the level map"
          />
          <span className="font-mono w-8 text-right">
            {Math.round(overlayOpacity * 100)}%
          </span>
        </label>

        <div className="w-px h-5 bg-slate-700" />

        <button
          type="button"
          disabled={disabled}
          onClick={() => onRoiEnabledChange(!roiEnabled)}
          title="Restrict the analysis to a rectangle (double-click the image to place one)"
          className={`px-2 py-1 text-xs rounded border transition-colors disabled:opacity-40 ${
            roiEnabled
              ? "bg-sky-600 border-sky-500 text-white"
              : "bg-slate-800/90 border-slate-600 text-slate-200 hover:bg-slate-700"
          }`}
        >
          ROI
        </button>
        {roiEnabled && hasRoi && (
          <button type="button" className={btn} onClick={onClearRoi}>
            Clear
          </button>
        )}

        <div className="w-px h-5 bg-slate-700" />

        <button type="button" className={btn} onClick={onExportPng} disabled={disabled}>
          PNG
        </button>
      </div>
    </div>
  );
}
