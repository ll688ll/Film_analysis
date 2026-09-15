/**
 * The dose map, recoloured in the browser from the embedded grid, with the
 * ROI outline, optional isodose lines and profile lines, a cursor readout,
 * and the film scan beside it for context.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { applyColormap, getColormapLUT, type ColormapName } from "../../analysis/colormaps";
import { fmt } from "../../analysis/format";
import { profileHalfSpan } from "../../analysis/profileMetrics";
import { MM_PER_INCH, roiAxes, roiCenter } from "../../analysis/roiGeometry";
import type { Isoline } from "../../analysis/roiTypes";
import type { DecodedGrid, Overlays } from "../ReportApp";
import type { ReportPayload, ReportRoi } from "../reportTypes";
import { buttonClass, Caption, inputClass, Section } from "../ui";

const COLORMAPS: ColormapName[] = ["jet", "viridis", "hot"];

interface Display {
  colormap: ColormapName;
  cmapMin: number;
  cmapMax: number;
}

interface DoseMapViewProps {
  payload: ReportPayload;
  grid: DecodedGrid | null;
  decodeError: string | null;
  display: Display;
  onDisplayChange: (d: Display) => void;
  overlays: Overlays;
  onOverlaysChange: (o: Overlays) => void;
  isolines: Isoline[] | null;
}

function pathD(path: number[]): string {
  let d = `M${path[0]} ${path[1]}`;
  for (let j = 2; j < path.length; j += 2) d += `L${path[j]} ${path[j + 1]}`;
  return d;
}

/** ROI, isolines and profile lines in image-pixel coordinates, over any view of the film. */
function Overlay({
  viewW,
  viewH,
  roi,
  dpi,
  isolines,
  show,
}: {
  viewW: number;
  viewH: number;
  roi: ReportRoi | null;
  dpi: number;
  isolines: Isoline[] | null;
  show: Overlays;
}) {
  const shape = useMemo(() => {
    if (!roi) return null;
    const g = roi.geometry;
    const { x: cx, y: cy } = roiCenter(g);
    if (roi.roiType === "Rectangle") {
      const c =
        roi.cornerCutEnabled && roi.cornerCutMm > 0
          ? Math.min((roi.cornerCutMm * dpi) / MM_PER_INCH, g.w / 2, g.h / 2)
          : 0;
      const chamfer =
        c > 0
          ? [
              [g.x + c, g.y],
              [g.x + g.w - c, g.y],
              [g.x + g.w, g.y + c],
              [g.x + g.w, g.y + g.h - c],
              [g.x + g.w - c, g.y + g.h],
              [g.x + c, g.y + g.h],
              [g.x, g.y + g.h - c],
              [g.x, g.y + c],
            ]
              .map((p) => p.join(","))
              .join(" ")
          : null;
      return (
        <g transform={`rotate(${g.rotation} ${cx} ${cy})`}>
          <rect
            x={g.x}
            y={g.y}
            width={g.w}
            height={g.h}
            fill="rgba(34,211,238,0.10)"
            stroke="#0891b2"
            strokeWidth={2}
            strokeDasharray="6 3"
            vectorEffect="non-scaling-stroke"
          />
          {chamfer && (
            <polygon
              points={chamfer}
              fill="none"
              stroke="#ea580c"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </g>
      );
    }
    const rx = g.w / 2;
    const ry = g.h / 2;
    return (
      <>
        <ellipse
          cx={cx}
          cy={cy}
          rx={rx}
          ry={ry}
          fill="rgba(34,211,238,0.10)"
          stroke="#0891b2"
          strokeWidth={2}
          strokeDasharray="6 3"
          vectorEffect="non-scaling-stroke"
        />
        {roi.roiType === "Ring" && (
          <ellipse
            cx={cx}
            cy={cy}
            rx={rx * (roi.holeRatio / 100)}
            ry={ry * (roi.holeRatio / 100)}
            fill="rgba(249,115,22,0.06)"
            stroke="#ea580c"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </>
    );
  }, [roi, dpi]);

  const profileLines = useMemo(() => {
    if (!roi) return null;
    const g = roi.geometry;
    const { x: cx, y: cy } = roiCenter(g);
    const { ux, uy, vx, vy } = roiAxes(g);
    const { u, v } = roi.profileOffset;
    const hs = profileHalfSpan(g, "h");
    const vs = profileHalfSpan(g, "v");
    // The horizontal line runs along u, pushed off centre along v; and vice versa.
    const hx = cx + v * vx;
    const hy = cy + v * vy;
    const vxc = cx + u * ux;
    const vyc = cy + u * uy;
    const crossX = cx + u * ux + v * vx;
    const crossY = cy + u * uy + v * vy;
    const style = {
      stroke: "#ca8a04",
      strokeWidth: 1.5,
      strokeDasharray: "8 4",
      vectorEffect: "non-scaling-stroke" as const,
    };
    return (
      <g>
        <line x1={hx - hs * ux} y1={hy - hs * uy} x2={hx + hs * ux} y2={hy + hs * uy} {...style} />
        <line x1={vxc - vs * vx} y1={vyc - vs * vy} x2={vxc + vs * vx} y2={vyc + vs * vy} {...style} />
        <circle cx={crossX} cy={crossY} r={Math.max(2, viewW / 200)} fill="#ca8a04" stroke="#0f172a" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </g>
    );
  }, [roi, viewW]);

  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox={`0 0 ${viewW} ${viewH}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {show.isolines &&
        isolines?.map((iso, i) =>
          iso.paths.map((p, j) => (
            <g key={`${i}-${j}`}>
              <path d={pathD(p)} fill="none" stroke="#0f172a" strokeWidth={3} opacity={0.6} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              <path d={pathD(p)} fill="none" stroke="#ffffff" strokeWidth={1.25} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </g>
          ))
        )}
      {show.roi && shape}
      {show.profiles && profileLines}
    </svg>
  );
}

/** Horizontal colour bar with five tick labels. */
function ColorBar({ colormap, min, max }: { colormap: ColormapName; min: number; max: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const lut = getColormapLUT(colormap);
    const img = ctx.createImageData(256, 1);
    for (let i = 0; i < 256; i++) {
      img.data[i * 4] = lut[i * 4];
      img.data[i * 4 + 1] = lut[i * 4 + 1];
      img.data[i * 4 + 2] = lut[i * 4 + 2];
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [colormap]);
  const range = max - min;
  const decimals = Math.abs(range) >= 100 ? 0 : Math.abs(range) >= 10 ? 1 : 2;
  const ticks = Array.from({ length: 5 }, (_, i) => (min + (range * i) / 4).toFixed(decimals));
  return (
    <div className="mt-2">
      <canvas ref={ref} width={256} height={1} className="block w-full h-3 rounded border border-slate-300" />
      <div className="flex justify-between text-[10px] font-mono text-slate-600 mt-0.5">
        {ticks.map((t, i) => (
          <span key={i}>{t}</span>
        ))}
        <span className="text-slate-400">Gy</span>
      </div>
    </div>
  );
}

interface Readout {
  x: number;
  y: number;
  dose: number;
}

export default function DoseMapView({
  payload,
  grid,
  decodeError,
  display,
  onDisplayChange,
  overlays,
  onOverlaysChange,
  isolines,
}: DoseMapViewProps) {
  const { film, doseGrid, roi, filmThumbnail } = payload;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [readout, setReadout] = useState<Readout | null>(null);

  // Repaint from the grid whenever the colouring changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !grid) return;
    canvas.width = grid.cols;
    canvas.height = grid.rows;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(
      applyColormap(grid.z, grid.cols, grid.rows, display.cmapMin, display.cmapMax, display.colormap),
      0,
      0
    );
  }, [grid, display]);

  const viewW = doseGrid.cols * doseGrid.step;
  const viewH = doseGrid.rows * doseGrid.step;
  const pixelMm = film.dpi > 0 ? MM_PER_INCH / film.dpi : null;

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !grid) return;
    const r = canvas.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    if (fx < 0 || fy < 0 || fx >= 1 || fy >= 1) {
      setReadout(null);
      return;
    }
    const gx = Math.floor(fx * grid.cols);
    const gy = Math.floor(fy * grid.rows);
    setReadout({
      x: (gx + 0.5) * grid.step,
      y: (gy + 0.5) * grid.step,
      dose: grid.z[gy * grid.cols + gx],
    });
  };

  const doseText = (d: number) => {
    if (!Number.isFinite(d)) return "no data";
    if (doseGrid.clamped && d >= doseGrid.hi) return `≥ ${fmt(doseGrid.hi, 2)} Gy`;
    if (doseGrid.clamped && d <= doseGrid.lo) return `≤ ${fmt(doseGrid.lo, 2)} Gy`;
    return `${fmt(d)} Gy`;
  };

  const setDisplayField = (patch: Partial<Display>) => onDisplayChange({ ...display, ...patch });
  const isDefault =
    display.colormap === payload.display.colormap &&
    display.cmapMin === payload.display.cmapMin &&
    display.cmapMax === payload.display.cmapMax;

  const toggle = (key: keyof Overlays, label: string, disabled = false) => (
    <label className={`inline-flex items-center gap-1.5 text-xs ${disabled ? "text-slate-400" : "text-slate-700"}`}>
      <input
        type="checkbox"
        className="accent-sky-600"
        checked={overlays[key]}
        disabled={disabled}
        onChange={(e) => onOverlaysChange({ ...overlays, [key]: e.target.checked })}
      />
      {label}
    </label>
  );

  return (
    <Section id="dose-map" title="Dose map">
      <div className="no-print flex flex-wrap items-center gap-x-4 gap-y-2 mb-3 text-xs text-slate-700">
        <label className="inline-flex items-center gap-1.5">
          Colormap
          <select
            value={display.colormap}
            onChange={(e) => setDisplayField({ colormap: e.target.value as ColormapName })}
            className="px-2 py-1 text-xs border border-slate-300 rounded bg-white"
          >
            {COLORMAPS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-1.5">
          Range
          <input
            type="number"
            step={0.1}
            value={display.cmapMin}
            onChange={(e) => setDisplayField({ cmapMin: Number(e.target.value) })}
            className={`w-20 ${inputClass}`}
            aria-label="Display minimum (Gy)"
          />
          –
          <input
            type="number"
            step={0.1}
            value={display.cmapMax}
            onChange={(e) => setDisplayField({ cmapMax: Number(e.target.value) })}
            className={`w-20 ${inputClass}`}
            aria-label="Display maximum (Gy)"
          />
          Gy
        </label>
        <button
          type="button"
          className={buttonClass}
          disabled={isDefault}
          onClick={() => onDisplayChange(payload.display)}
          title="Back to the display the report was exported with"
        >
          Reset
        </button>
        <span className="flex flex-wrap items-center gap-3 ml-auto">
          {toggle("roi", "ROI outline", !roi)}
          {toggle("isolines", "Isodose lines", !roi || !isolines)}
          {toggle("profiles", "Profile lines", !roi)}
        </span>
      </div>

      <div className={`grid gap-4 ${filmThumbnail ? "md:grid-cols-2" : ""}`}>
        {filmThumbnail && (
          <figure className="min-w-0">
            <div className="relative bg-slate-100 rounded overflow-hidden">
              <img src={filmThumbnail} alt="Film scan" className="block w-full h-auto" />
              <Overlay viewW={film.width} viewH={film.height} roi={roi} dpi={film.dpi} isolines={isolines} show={overlays} />
            </div>
            <figcaption className="mt-1 text-xs text-slate-500">Film scan</figcaption>
          </figure>
        )}
        <figure className="min-w-0">
          <div
            className="relative bg-slate-100 rounded overflow-hidden cursor-crosshair"
            onMouseMove={handleMove}
            onMouseLeave={() => setReadout(null)}
          >
            {grid ? (
              <canvas ref={canvasRef} className="report-canvas" />
            ) : (
              <div
                className="flex items-center justify-center text-sm text-slate-500"
                style={{ aspectRatio: `${viewW} / ${viewH}` }}
              >
                {decodeError ? `Dose map unavailable: ${decodeError}` : "Decoding dose map…"}
              </div>
            )}
            {grid && <Overlay viewW={viewW} viewH={viewH} roi={roi} dpi={film.dpi} isolines={isolines} show={overlays} />}
            {readout && (
              <div className="absolute top-2 left-2 bg-white/90 border border-slate-300 rounded px-2 py-1 text-xs font-mono pointer-events-none shadow-sm">
                <span className="font-semibold text-sky-700">{doseText(readout.dose)}</span>
                <span className="text-slate-500 ml-2">
                  ({Math.round(readout.x)}, {Math.round(readout.y)}) px
                  {pixelMm ? ` · ${(readout.x * pixelMm).toFixed(1)}, ${(readout.y * pixelMm).toFixed(1)} mm` : ""}
                </span>
              </div>
            )}
          </div>
          <figcaption className="mt-1 text-xs text-slate-500">
            Dose map · {display.colormap}, {display.cmapMin}–{display.cmapMax} Gy
          </figcaption>
          <ColorBar colormap={display.colormap} min={display.cmapMin} max={display.cmapMax} />
        </figure>
      </div>

      <Caption>
        Hover the dose map to read the dose at a point. The map in this file is averaged over{" "}
        {doseGrid.step} × {doseGrid.step} px blocks ({doseGrid.cols} × {doseGrid.rows}); the
        statistics below were computed on the full-resolution map.
        {doseGrid.clamped
          ? ` Dose values outside ${fmt(doseGrid.lo, 2)}–${fmt(doseGrid.hi, 2)} Gy (film edges, scanner bed) are clamped in this file; the full map ranged ${fmt(doseGrid.doseMin, 2)} to ${fmt(doseGrid.doseMax, 2)} Gy.`
          : ""}
      </Caption>
    </Section>
  );
}
