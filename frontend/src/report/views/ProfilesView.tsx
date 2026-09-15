import { useMemo } from "react";
import Plot from "../../components/Plot";
import { fmt } from "../../analysis/format";
import { LIGHT_PALETTE, PLOT_CONFIG, PLOT_LIGHT_AXIS, PLOT_LIGHT_LAYOUT } from "../../analysis/plotTheme";
import { profileMetrics, type DoseProfile, type ProfileMetrics } from "../../analysis/profileMetrics";
import { profileFigure } from "../../analysis/roiCharts";
import { downloadCsvFile, profilesToCSV, type ExportMeta } from "../../analysis/roiExport";
import type { ReportRoi } from "../reportTypes";
import { buttonClass, Caption, IconDownload, Section } from "../ui";

function ProfileChart({ title, profile, metrics }: { title: string; profile: DoseProfile; metrics: ProfileMetrics }) {
  const { data, shapes } = useMemo(() => profileFigure(profile, metrics, LIGHT_PALETTE), [profile, metrics]);
  const offsetLabel =
    Math.abs(profile.offsetMm) < 0.005
      ? "through the centre"
      : `${profile.offsetMm > 0 ? "+" : ""}${fmt(profile.offsetMm, 1)} mm off centre`;
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2 mb-1 text-xs">
        <span className="font-medium text-slate-700">
          {title} <span className="text-slate-500">· {offsetLabel}</span>
        </span>
        <span className="font-mono text-slate-700">
          Max <b className="text-slate-900">{fmt(metrics.maxDose)}</b> Gy
          {metrics.maxPosMm != null ? ` @ ${fmt(metrics.maxPosMm, 1)} mm` : ""}
        </span>
      </div>
      <div className="h-52">
        <Plot
          data={data}
          layout={{
            ...PLOT_LIGHT_LAYOUT,
            shapes,
            xaxis: { ...PLOT_LIGHT_AXIS, title: { text: "Position (mm)" } },
            yaxis: { ...PLOT_LIGHT_AXIS, title: { text: "Gy" }, rangemode: "tozero" },
          }}
          config={PLOT_CONFIG}
          useResizeHandler
          style={{ width: "100%", height: "100%" }}
        />
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 text-xs font-mono text-slate-700">
        <span>
          FWHM <b className="text-slate-900">{fmt(metrics.fwhmMm, 2)}</b> mm
        </span>
        <span>
          Penumbra 80–20 % L <b className="text-slate-900">{fmt(metrics.penumbraLeftMm, 2)}</b> / R{" "}
          <b className="text-slate-900">{fmt(metrics.penumbraRightMm, 2)}</b> mm
        </span>
      </div>
    </div>
  );
}

/** Dose profiles along the ROI's width and height axes, at the author's crosshair position. */
export default function ProfilesView({ roi, exportMeta, filmName }: { roi: ReportRoi; exportMeta: ExportMeta; filmName: string | null }) {
  const { h, v } = roi.profiles;
  const hMetrics = useMemo(() => profileMetrics(h), [h]);
  const vMetrics = useMemo(() => profileMetrics(v), [v]);
  const ready = !!(h || v);

  return (
    <Section
      id="profiles"
      title="Dose profiles"
      actions={
        <button
          type="button"
          className={buttonClass}
          disabled={!ready}
          onClick={() =>
            downloadCsvFile(
              profilesToCSV(h ? { profile: h, metrics: hMetrics } : null, v ? { profile: v, metrics: vMetrics } : null, exportMeta),
              filmName,
              "roi_profiles"
            )
          }
          title="Download both profiles as CSV"
        >
          <IconDownload />
          CSV
        </button>
      }
    >
      {!ready && <p className="text-sm text-slate-500">The ROI had no pixels inside the image.</p>}
      <div className="grid md:grid-cols-2 gap-6">
        {h && <ProfileChart title="Horizontal · width axis" profile={h} metrics={hMetrics} />}
        {v && <ProfileChart title="Vertical · height axis" profile={v} metrics={vMetrics} />}
      </div>
      {ready && (
        <Caption>
          Sampled every image pixel through the crosshair the author placed (tick “Profile lines”
          on the dose map to see where). Shaded band = ROI extent; dotted grey lines mark 80 / 50 /
          20 % of the in-ROI maximum, the yellow lines the 50 % crossings, and the dotted dark line
          where the other profile crosses this one.
          {hMetrics.fwhmMm == null || vMetrics.fwhmMm == null
            ? " A dash means the profile never drops to that level within the sampled range."
            : ""}
        </Caption>
      )}
    </Section>
  );
}
