import { useMemo } from "react";
import Plot from "../components/Plot";
import { fmt } from "./format";
import { IconDownload, toolbarButtonClass } from "./panelIcons";
import { DARK_PALETTE, PLOT_AXIS, PLOT_BASE_LAYOUT, PLOT_CONFIG } from "./plotTheme";
import { profileFigure } from "./roiCharts";
import {
  profileMetrics,
  type DoseProfile,
  type ProfileMetrics,
} from "./profileMetrics";
import { downloadCsvFile, profilesToCSV, type ExportMeta } from "./roiExport";

export interface ProfilePair {
  h: DoseProfile | null;
  v: DoseProfile | null;
}

interface RoiProfilesProps {
  profiles: ProfilePair | null;
  hasRoi: boolean;
  exportMeta: ExportMeta;
  filmName: string | null;
}

function ProfileChart({
  title,
  profile,
  metrics,
}: {
  title: string;
  profile: DoseProfile;
  metrics: ProfileMetrics;
}) {
  const { data, shapes } = useMemo(
    () => profileFigure(profile, metrics, DARK_PALETTE),
    [profile, metrics]
  );

  const offsetLabel =
    Math.abs(profile.offsetMm) < 0.005
      ? "through the centre"
      : `${profile.offsetMm > 0 ? "+" : ""}${fmt(profile.offsetMm, 1)} mm off centre`;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-medium text-slate-400">
          {title}
          <span className="text-slate-500"> · {offsetLabel}</span>
        </span>
        <span className="text-[11px] font-mono text-slate-300">
          Max <b className="font-semibold text-slate-100">{fmt(metrics.maxDose)}</b> Gy
          {metrics.maxPosMm != null ? ` @ ${fmt(metrics.maxPosMm, 1)} mm` : ""}
        </span>
      </div>
      <div className="h-40">
        <Plot
          data={data}
          layout={{
            ...PLOT_BASE_LAYOUT,
            shapes,
            xaxis: { ...PLOT_AXIS, title: { text: "Position (mm)" } },
            yaxis: { ...PLOT_AXIS, title: { text: "Gy" }, rangemode: "tozero" },
          }}
          config={PLOT_CONFIG}
          useResizeHandler
          style={{ width: "100%", height: "100%" }}
        />
      </div>
      <div className="mt-1 flex gap-3 text-[11px] font-mono text-slate-300">
        <span>
          FWHM <b className="font-semibold text-slate-100">{fmt(metrics.fwhmMm, 2)}</b> mm
        </span>
        <span>
          Penumbra L <b className="font-semibold text-slate-100">{fmt(metrics.penumbraLeftMm, 2)}</b> / R{" "}
          <b className="font-semibold text-slate-100">{fmt(metrics.penumbraRightMm, 2)}</b> mm
        </span>
      </div>
    </div>
  );
}

/** Dose profiles through the ROI centre along its width and height axes. */
export default function RoiProfiles({
  profiles,
  hasRoi,
  exportMeta,
  filmName,
}: RoiProfilesProps) {
  const hMetrics = useMemo(() => profileMetrics(profiles?.h ?? null), [profiles]);
  const vMetrics = useMemo(() => profileMetrics(profiles?.v ?? null), [profiles]);
  const ready = !!(profiles && (profiles.h || profiles.v));

  const handleDownload = () => {
    if (!profiles) return;
    downloadCsvFile(
      profilesToCSV(
        profiles.h ? { profile: profiles.h, metrics: hMetrics } : null,
        profiles.v ? { profile: profiles.v, metrics: vMetrics } : null,
        exportMeta
      ),
      filmName,
      "roi_profiles"
    );
  };

  return (
    <div className="p-4 flex flex-col gap-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500 truncate">
          Drag the yellow crosshair on the map to move the profiles
        </span>
        <button
          type="button"
          onClick={handleDownload}
          disabled={!ready}
          title="Download both profiles as CSV"
          className={toolbarButtonClass}
        >
          <IconDownload size={14} />
          CSV
        </button>
      </div>

      {!ready && (
        <p className="text-sm text-slate-500">
          {hasRoi
            ? "The ROI has no pixels inside the image."
            : "Draw an ROI on the dose map to see its profiles."}
        </p>
      )}

      {profiles?.h && (
        <ProfileChart title="Horizontal · width axis" profile={profiles.h} metrics={hMetrics} />
      )}
      {profiles?.v && (
        <ProfileChart title="Vertical · height axis" profile={profiles.v} metrics={vMetrics} />
      )}

      {ready && (
        <p className="text-xs text-slate-500">
          Shaded band = ROI extent. Dotted grey lines mark 80 / 50 / 20 % of
          the in-ROI maximum, yellow lines the 50 % crossings, and the dotted
          white line where the other profile crosses this one.
          {hMetrics.fwhmMm == null || vMetrics.fwhmMm == null
            ? " A dash means the profile never drops to that level within the sampled range; enlarge the ROI past the field edge to measure it."
            : ""}
        </p>
      )}
    </div>
  );
}
