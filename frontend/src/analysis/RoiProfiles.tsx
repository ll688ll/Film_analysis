import { useMemo } from "react";
import Plot from "react-plotly.js";
import { fmt } from "./format";
import { IconDownload, toolbarButtonClass } from "./panelIcons";
import { PLOT_AXIS, PLOT_BASE_LAYOUT, PLOT_CONFIG, verticalLine } from "./plotTheme";
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
  const { data, shapes } = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any[] = [
      {
        type: "scatter",
        mode: "lines",
        x: profile.positionMm,
        y: profile.dose,
        line: { color: "#38bdf8", width: 1.5 },
        hovertemplate: "%{x:.2f} mm: %{y:.3f} Gy<extra></extra>",
      },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shapes: any[] = [
      {
        type: "rect",
        x0: -profile.halfExtentMm,
        x1: profile.halfExtentMm,
        y0: 0,
        y1: 1,
        yref: "paper",
        fillcolor: "rgba(34,211,238,0.10)",
        line: { width: 0 },
        layer: "below",
      },
    ];
    if (metrics.maxDose != null) {
      for (const frac of [0.8, 0.5, 0.2]) {
        shapes.push({
          type: "line",
          xref: "paper",
          x0: 0,
          x1: 1,
          y0: frac * metrics.maxDose,
          y1: frac * metrics.maxDose,
          line: { color: "#94a3b8", width: 1, dash: "dot" },
        });
      }
    }
    if (metrics.left50Mm != null) shapes.push(verticalLine(metrics.left50Mm, "#facc15"));
    if (metrics.right50Mm != null) shapes.push(verticalLine(metrics.right50Mm, "#facc15"));
    // Where the other crosshair line crosses this profile
    shapes.push(verticalLine(profile.crossMm, "#f8fafc", "dot"));
    return { data, shapes };
  }, [profile, metrics]);

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
