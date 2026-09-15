/**
 * The report page. Decodes the embedded arrays once, then renders the same
 * views the Film Dose panel shows, on a light, printable page.
 */

import { useEffect, useMemo, useState } from "react";
import { DEFAULT_CONTOUR_SETTINGS, contourLevels } from "../analysis/contourLevels";
import { buildIsolines } from "../analysis/isolines";
import type { RoiCrop } from "../analysis/roiCrop";
import type { ExportMeta } from "../analysis/roiExport";
import type { ContourSettings, Isoline } from "../analysis/roiTypes";
import { dequantize } from "./doseGrid";
import { bytesToFloat32, bytesToUint16, decodeBytes } from "./encode";
import type { ReportPayload } from "./reportTypes";
import { buttonClass } from "./ui";
import CalibrationView from "./views/CalibrationView";
import ContourView from "./views/ContourView";
import DoseMapView from "./views/DoseMapView";
import HistogramView from "./views/HistogramView";
import MethodView from "./views/MethodView";
import ProfilesView from "./views/ProfilesView";
import StatsView from "./views/StatsView";
import SummaryView from "./views/SummaryView";

export interface DecodedGrid {
  z: Float32Array;
  cols: number;
  rows: number;
  step: number;
}

/** Which outlines the dose map draws. */
export interface Overlays {
  roi: boolean;
  isolines: boolean;
  profiles: boolean;
}

const SECTIONS = [
  { id: "summary", label: "Summary" },
  { id: "dose-map", label: "Dose map" },
  { id: "statistics", label: "Statistics", roi: true },
  { id: "histogram", label: "Histogram", roi: true },
  { id: "isodose", label: "Isodose", roi: true },
  { id: "profiles", label: "Profiles", roi: true },
  { id: "calibration", label: "Calibration" },
  { id: "method", label: "Method" },
];

export default function ReportApp({ payload }: { payload: ReportPayload }) {
  const roi = payload.roi;
  const stats = roi?.stats ?? null;

  const [grid, setGrid] = useState<DecodedGrid | null>(null);
  const [crop, setCrop] = useState<RoiCrop | null>(null);
  const [decodeError, setDecodeError] = useState<string | null>(null);
  const [display, setDisplay] = useState(payload.display);
  const [contour, setContour] = useState<ContourSettings>({
    ...DEFAULT_CONTOUR_SETTINGS,
    ...(roi?.contour ?? {}),
  });
  const [overlays, setOverlays] = useState<Overlays>({
    roi: true,
    isolines: roi?.contour.overlay ?? false,
    profiles: false,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const g = payload.doseGrid;
        const codes = bytesToUint16(await decodeBytes(g));
        if (cancelled) return;
        setGrid({ z: dequantize(codes, g.lo, g.hi), cols: g.cols, rows: g.rows, step: g.step });
        const c = payload.roi?.crop;
        if (c) {
          const z = bytesToFloat32(await decodeBytes(c.z));
          if (cancelled) return;
          setCrop({
            x0: c.x0,
            y0: c.y0,
            step: c.step,
            cols: c.cols,
            rows: c.rows,
            z,
            xMm: c.xMm,
            yMm: c.yMm,
            roiMin: c.roiMin,
            roiMax: c.roiMax,
            maskedCount: c.maskedCount,
          });
        }
      } catch (err) {
        if (!cancelled) setDecodeError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [payload]);

  // Same level logic as the panel: "95 %" is 95 % of the statistics' maximum
  const refMax = stats?.max ?? crop?.roiMax ?? null;
  const customLevels = contour.mode === "percent" ? contour.customPercent : contour.customGy;
  const levels = useMemo(
    () =>
      crop
        ? contourLevels(
            contour.mode,
            contour.levels,
            refMax,
            crop.roiMin,
            crop.roiMax,
            { min: contour.rangeMin, max: contour.rangeMax },
            customLevels
          )
        : null,
    [crop, contour.mode, contour.levels, contour.rangeMin, contour.rangeMax, customLevels, refMax]
  );
  const isolines = useMemo<Isoline[] | null>(
    () => (crop && levels ? buildIsolines(crop, levels, contour.smooth) : null),
    [crop, levels, contour.smooth]
  );

  const exportMeta = useMemo<ExportMeta>(
    () => ({
      filmName: payload.film.filename,
      roiType: roi?.roiType ?? "Rectangle",
      trimEnabled: roi?.trimEnabled ?? false,
      trimPercent: roi?.trimPercent ?? 0,
      cornerCutMm: roi?.cornerCutEnabled ? roi.cornerCutMm : 0,
      threshold: roi?.threshold ?? 0,
    }),
    [payload.film.filename, roi]
  );

  const title = payload.meta.title || payload.film.filename || "Film dose report";
  const subtitle = [payload.meta.author, payload.meta.institution].filter(Boolean).join(" · ");
  const generated = new Date(payload.generatedAt);
  const sections = SECTIONS.filter((s) => !s.roi || (roi && stats));

  return (
    <div className="report-page max-w-5xl mx-auto px-6 py-8">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
            Film dose report
          </p>
          <h1 className="text-2xl font-semibold text-slate-900 mt-1 break-words">{title}</h1>
          <p className="text-sm text-slate-600 mt-1">
            {subtitle && <span>{subtitle} · </span>}
            {generated.toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-2 no-print">
          <button type="button" onClick={() => window.print()} className={buttonClass}>
            Print / Save as PDF
          </button>
        </div>
      </header>

      <nav
        aria-label="Report sections"
        className="no-print sticky top-0 z-10 -mx-6 px-6 py-2 mb-5 bg-slate-100/95 backdrop-blur border-b border-slate-200 flex flex-wrap gap-x-4 gap-y-1 text-sm"
      >
        {sections.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="text-sky-700 hover:underline">
            {s.label}
          </a>
        ))}
      </nav>

      <SummaryView payload={payload} />

      <DoseMapView
        payload={payload}
        grid={grid}
        decodeError={decodeError}
        display={display}
        onDisplayChange={setDisplay}
        overlays={overlays}
        onOverlaysChange={setOverlays}
        isolines={isolines}
      />

      {roi && stats && (
        <>
          <StatsView roi={roi} exportMeta={exportMeta} />
          <HistogramView stats={stats} exportMeta={exportMeta} filmName={payload.film.filename} />
          <ContourView
            crop={crop}
            levels={levels}
            isolines={isolines}
            colormap={display.colormap}
            dpi={payload.film.dpi}
            refMax={refMax}
            settings={contour}
            onSettingsChange={(patch) => setContour((c) => ({ ...c, ...patch }))}
            overlayOnMap={overlays.isolines}
            onOverlayOnMapChange={(v) => setOverlays((o) => ({ ...o, isolines: v }))}
          />
          <ProfilesView roi={roi} exportMeta={exportMeta} filmName={payload.film.filename} />
        </>
      )}

      <CalibrationView calibration={payload.calibration} />
      <MethodView payload={payload} />

      <footer className="mt-8 text-xs text-slate-400 leading-relaxed">
        Generated by Film Analysis{payload.app.version ? ` v${payload.app.version}` : ""} on{" "}
        {generated.toLocaleString()} · report schema {payload.schema}. This file is
        self-contained: the statistics were computed on the full-resolution dose map at
        export time and do not change when the view is adjusted.
      </footer>
    </div>
  );
}
