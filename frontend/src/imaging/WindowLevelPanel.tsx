import { useState } from "react";
import {
  autoWL,
  fullRangeWL,
  isFullRange,
  rangeToWl,
  wlToRange,
  type BackdropMode,
  type WindowLevel,
} from "./windowLevel";
import type { AnalyzeResponse } from "./types";

interface WindowLevelPanelProps {
  wl: WindowLevel;
  onChange: (wl: WindowLevel) => void;
  backdrop: BackdropMode;
  onBackdropChange: (m: BackdropMode) => void;
  hist: AnalyzeResponse | null;
  overlayOpacity: number;
  onOverlayOpacityChange: (v: number) => void;
  disabled: boolean;
}

const SLIDER_STEPS = 1000;

function fmt(v: number): string {
  if (!isFinite(v)) return "—";
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2);
}

/**
 * Transfer-function preview: the ramp from black to white across the window.
 * Flat outside the window, sloped inside, mirrored when inverted.
 */
function RampPreview({
  wl,
  dataMin,
  dataMax,
}: {
  wl: WindowLevel;
  dataMin: number;
  dataMax: number;
}) {
  const span = Math.max(dataMax - dataMin, 1e-9);
  const [lo, hi] = wlToRange(wl);
  const x = (v: number) => Math.max(0, Math.min(100, ((v - dataMin) / span) * 100));
  const yLow = wl.invert ? 2 : 38;
  const yHigh = wl.invert ? 38 : 2;

  const points = [
    `0,${yLow}`,
    `${x(lo)},${yLow}`,
    `${x(hi)},${yHigh}`,
    `100,${yHigh}`,
  ].join(" ");

  return (
    <svg
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      className="w-full h-16 rounded border border-slate-600 bg-slate-800/60"
    >
      <defs>
        <linearGradient id="wl-ramp" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor={wl.invert ? "#f8fafc" : "#0f172a"} />
          <stop offset={`${x(lo)}%`} stopColor={wl.invert ? "#f8fafc" : "#0f172a"} />
          <stop offset={`${x(hi)}%`} stopColor={wl.invert ? "#0f172a" : "#f8fafc"} />
          <stop offset="100%" stopColor={wl.invert ? "#0f172a" : "#f8fafc"} />
        </linearGradient>
      </defs>
      {/* Gradient strip showing the resulting greys */}
      <rect x="0" y="32" width="100" height="8" fill="url(#wl-ramp)" />
      <polyline
        points={points}
        fill="none"
        stroke="#38bdf8"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export default function WindowLevelPanel({
  wl,
  onChange,
  backdrop,
  onBackdropChange,
  hist,
  overlayOpacity,
  onOverlayOpacityChange,
  disabled,
}: WindowLevelPanelProps) {
  const [showSet, setShowSet] = useState(false);

  const dataMin = hist?.data_min ?? 0;
  const dataMax = hist?.data_max ?? 255;
  const span = Math.max(dataMax - dataMin, 1e-9);
  const [lo, hi] = wlToRange(wl);

  const busy = disabled || !hist;
  // The backdrop is invisible while the level map is fully opaque.
  const hidden = overlayOpacity >= 0.99;

  const update = (next: WindowLevel) => {
    onChange(next);
    if (backdrop !== "windowed") onBackdropChange("windowed");
  };

  const btn =
    "px-2 py-1.5 text-xs font-medium rounded border bg-slate-800 border-slate-600 " +
    "text-slate-300 hover:bg-slate-600 disabled:opacity-50";

  return (
    <div className="p-4 border-b border-slate-600">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Window / Level
        </h2>
        <div className="flex rounded overflow-hidden border border-slate-600">
          {(["original", "windowed"] as BackdropMode[]).map((m) => (
            <button
              key={m}
              type="button"
              disabled={busy}
              onClick={() => onBackdropChange(m)}
              className={`px-2 py-0.5 text-[11px] transition-colors ${
                backdrop === m
                  ? "bg-sky-600 text-white"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-600"
              } disabled:opacity-50`}
            >
              {m === "original" ? "Original" : "W/L"}
            </button>
          ))}
        </div>
      </div>

      <RampPreview wl={wl} dataMin={dataMin} dataMax={dataMax} />

      {/* Level */}
      <div className="mt-3">
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-slate-400">Level</label>
          <span className="text-xs font-mono text-slate-300">{fmt(wl.level)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={SLIDER_STEPS}
          value={Math.round(((wl.level - dataMin) / span) * SLIDER_STEPS)}
          disabled={busy}
          onChange={(e) =>
            update({ ...wl, level: dataMin + (Number(e.target.value) / SLIDER_STEPS) * span })
          }
          className="w-full accent-sky-500 disabled:opacity-50"
        />
      </div>

      {/* Window */}
      <div className="mt-2">
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-slate-400">Window</label>
          <span className="text-xs font-mono text-slate-300">{fmt(wl.window)}</span>
        </div>
        <input
          type="range"
          min={1}
          max={SLIDER_STEPS}
          value={Math.round((Math.min(wl.window, span) / span) * SLIDER_STEPS)}
          disabled={busy}
          onChange={(e) =>
            update({ ...wl, window: (Number(e.target.value) / SLIDER_STEPS) * span })
          }
          className="w-full accent-sky-500 disabled:opacity-50"
        />
      </div>

      <p className="mt-1.5 text-[11px] text-slate-500 font-mono">
        Displays {fmt(lo)} … {fmt(hi)}
      </p>

      {/* Buttons -- 2x2, mirroring the classic W&L dialog */}
      <div className="grid grid-cols-2 gap-2 mt-3">
        <button
          type="button"
          disabled={busy || hist?.overall.p1 == null}
          title="Auto contrast from the 1st to 99th percentile"
          onClick={() =>
            hist && update(autoWL(hist.overall.p1!, hist.overall.p99!, wl.invert))
          }
          className={btn}
        >
          Auto
        </button>
        <button
          type="button"
          disabled={busy}
          title="Back to the full data range"
          onClick={() => {
            onChange(fullRangeWL(dataMin, dataMax, false));
            onBackdropChange("original");
            setShowSet(false);
          }}
          className={btn}
        >
          Reset
        </button>
        <button
          type="button"
          disabled={busy}
          title="Type exact values"
          onClick={() => setShowSet((v) => !v)}
          className={`${btn} ${showSet ? "ring-1 ring-sky-500" : ""}`}
        >
          Set
        </button>
        <button
          type="button"
          disabled={busy}
          title="Invert the greyscale ramp"
          onClick={() => update({ ...wl, invert: !wl.invert })}
          className={`px-2 py-1.5 text-xs font-medium rounded border transition-colors disabled:opacity-50 ${
            wl.invert
              ? "bg-sky-600 border-sky-500 text-white"
              : "bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-600"
          }`}
        >
          Invert
        </button>
      </div>

      {showSet && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="text-[11px] text-slate-400">
            Level
            <input
              type="number"
              value={Number(wl.level.toFixed(4))}
              disabled={busy}
              onChange={(e) => update({ ...wl, level: Number(e.target.value) })}
              className="mt-0.5 w-full px-2 py-1 text-xs bg-slate-800 border border-slate-600 rounded text-slate-200"
            />
          </label>
          <label className="text-[11px] text-slate-400">
            Window
            <input
              type="number"
              value={Number(wl.window.toFixed(4))}
              disabled={busy}
              onChange={(e) =>
                update({ ...wl, window: Math.max(1e-9, Number(e.target.value)) })
              }
              className="mt-0.5 w-full px-2 py-1 text-xs bg-slate-800 border border-slate-600 rounded text-slate-200"
            />
          </label>
          <label className="text-[11px] text-slate-400">
            Min
            <input
              type="number"
              value={Number(lo.toFixed(4))}
              disabled={busy}
              onChange={(e) => update(rangeToWl(Number(e.target.value), hi, wl.invert))}
              className="mt-0.5 w-full px-2 py-1 text-xs bg-slate-800 border border-slate-600 rounded text-slate-200"
            />
          </label>
          <label className="text-[11px] text-slate-400">
            Max
            <input
              type="number"
              value={Number(hi.toFixed(4))}
              disabled={busy}
              onChange={(e) => update(rangeToWl(lo, Number(e.target.value), wl.invert))}
              className="mt-0.5 w-full px-2 py-1 text-xs bg-slate-800 border border-slate-600 rounded text-slate-200"
            />
          </label>
        </div>
      )}

      {backdrop === "windowed" && hidden && (
        <div className="mt-3 flex items-center gap-2 rounded border border-amber-700/60 bg-amber-900/30 px-2 py-1.5">
          <span className="text-[11px] text-amber-200 flex-1">
            The level map is fully opaque, so the image underneath is hidden.
          </span>
          <button
            type="button"
            onClick={() => onOverlayOpacityChange(0.5)}
            className="px-2 py-0.5 text-[11px] rounded bg-amber-700/60 text-amber-50 hover:bg-amber-700"
          >
            Show
          </button>
        </div>
      )}

      <p className="mt-2 text-[11px] text-slate-500">
        Display only — level boundaries and statistics are unaffected.
        {backdrop === "windowed" && hist ? ` Greys quantised to ${hist.bins} bins.` : ""}
      </p>

      {!isFullRange(wl, dataMin, dataMax) && backdrop === "original" && (
        <p className="mt-1 text-[11px] text-amber-400/80">
          Backdrop is set to Original — switch to W/L to see this adjustment.
        </p>
      )}
    </div>
  );
}
