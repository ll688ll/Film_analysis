/**
 * Vertical dose color bar legend for the dose map.
 * Uses the same colormap LUT as the rendered map so colors match exactly.
 */

import { useEffect, useMemo, useRef } from "react";
import { getColormapLUT, type ColormapName } from "./colormaps";

const BAR_WIDTH = 14;
const BAR_HEIGHT = 240;
const TICK_COUNT = 6;

interface ColorBarProps {
  colormap: ColormapName;
  cmapMin: number;
  cmapMax: number;
}

function formatTick(v: number, range: number): string {
  if (!isFinite(v)) return "—";
  if (range >= 100) return v.toFixed(0);
  if (range >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

export default function ColorBar({ colormap, cmapMin, cmapMax }: ColorBarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Paint the vertical gradient: top = cmapMax, bottom = cmapMin
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const lut = getColormapLUT(colormap);
    const img = ctx.createImageData(BAR_WIDTH, BAR_HEIGHT);
    for (let y = 0; y < BAR_HEIGHT; y++) {
      const idx = Math.round((1 - y / (BAR_HEIGHT - 1)) * 255);
      const k = idx * 4;
      for (let x = 0; x < BAR_WIDTH; x++) {
        const j = (y * BAR_WIDTH + x) * 4;
        img.data[j] = lut[k];
        img.data[j + 1] = lut[k + 1];
        img.data[j + 2] = lut[k + 2];
        img.data[j + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [colormap]);

  const ticks = useMemo(() => {
    const range = cmapMax - cmapMin;
    return Array.from({ length: TICK_COUNT }, (_, i) => {
      const frac = i / (TICK_COUNT - 1); // 0 = top of the bar
      return {
        topPct: frac * 100,
        label: formatTick(cmapMax - frac * range, Math.abs(range)),
      };
    });
  }, [cmapMin, cmapMax]);

  return (
    <div className="bg-slate-800/90 border border-slate-600 rounded-lg px-2 py-2 pointer-events-none select-none">
      <p className="text-[10px] text-slate-400 text-center mb-1 font-medium">
        Gy
      </p>
      <div className="flex items-stretch gap-1.5">
        <canvas
          ref={canvasRef}
          width={BAR_WIDTH}
          height={BAR_HEIGHT}
          className="rounded border border-slate-600"
          style={{ width: BAR_WIDTH, height: BAR_HEIGHT }}
        />
        <div className="relative w-9" style={{ height: BAR_HEIGHT }}>
          {ticks.map((t) => (
            <span
              key={t.topPct}
              className="absolute left-0 -translate-y-1/2 text-[10px] font-mono text-slate-300 leading-none"
              style={{ top: `${t.topPct}%` }}
            >
              {t.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
