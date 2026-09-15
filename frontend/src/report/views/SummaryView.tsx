import { fmt } from "../../analysis/format";
import { MM_PER_INCH } from "../../analysis/roiGeometry";
import type { ReportPayload } from "../reportTypes";
import { Section } from "../ui";

function Tile({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5">
      <div className="text-[10px] leading-3 uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold font-mono text-slate-900 truncate">{value}</div>
      <div className="text-[10px] leading-3 text-slate-500">{unit}</div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-1 border-b border-slate-100 last:border-0">
      <dt className="w-36 flex-shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 text-slate-800 break-words">{children}</dd>
    </div>
  );
}

/** The four numbers, the facts of the study, and what the author wrote. */
export default function SummaryView({ payload }: { payload: ReportPayload }) {
  const { film, calibration, display, meta, roi } = payload;
  const stats = roi?.stats ?? null;
  const pixelMm = film.dpi > 0 ? MM_PER_INCH / film.dpi : null;

  return (
    <Section id="summary" title="Summary">
      {stats ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <Tile label="Mean" value={fmt(stats.mean)} unit="Gy" />
          <Tile label="Std" value={fmt(stats.std)} unit="Gy" />
          <Tile label="CV" value={fmt(stats.cv, 2)} unit="%" />
          <Tile label="Max" value={fmt(stats.max)} unit="Gy" />
        </div>
      ) : (
        <p className="mb-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          No region of interest was placed, so this report holds the dose map and its
          calibration only.
        </p>
      )}

      {meta.comment && (
        <div className="mb-4 text-sm text-slate-800 whitespace-pre-wrap border-l-4 border-sky-500 bg-sky-50 rounded-r px-3 py-2">
          {meta.comment}
        </div>
      )}

      <dl className="text-sm">
        <Fact label="Film scan">{film.filename ?? "—"}</Fact>
        <Fact label="Image">
          {film.width} × {film.height} px · {film.channels} channel{film.channels === 1 ? "" : "s"}
          {film.bitDepth ? ` · ${film.bitDepth}-bit` : ""}
        </Fact>
        <Fact label="Resolution">
          {film.dpi} dpi{pixelMm ? ` · ${pixelMm.toFixed(4)} mm per pixel` : ""}
        </Fact>
        <Fact label="Calibration">
          {calibration.profileName ?? "Manual coefficients"} · {calibration.channel} channel
          {calibration.source === "snapshot" ? " (snapshot saved with the analysis)" : ""}
        </Fact>
        <Fact label="Coefficients">
          <span className="font-mono">
            a = {calibration.a.toFixed(5)}, b = {calibration.b.toFixed(5)}, c ={" "}
            {calibration.c.toFixed(5)}
          </span>
        </Fact>
        <Fact label="Display range">
          {display.cmapMin} – {display.cmapMax} Gy · {display.colormap}
        </Fact>
        {roi && (
          <Fact label="ROI">
            {roi.roiType}
            {roi.roiType === "Ring" ? ` · hole ${roi.holeRatio} %` : ""}
            {roi.geometry.rotation ? ` · ${roi.geometry.rotation}°` : ""}
            {stats ? ` · ${fmt(stats.width_mm, 1)} × ${fmt(stats.height_mm, 1)} mm` : ""}
          </Fact>
        )}
        {film.project && <Fact label="Project">{film.project}</Fact>}
        {film.savedAnalysisId !== null && (
          <Fact label="Saved analysis">#{film.savedAnalysisId}</Fact>
        )}
        {film.notes && (
          <Fact label="Analysis notes">
            <span className="whitespace-pre-wrap">{film.notes}</span>
          </Fact>
        )}
      </dl>
    </Section>
  );
}
