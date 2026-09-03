import { useEffect, useMemo } from "react";
import SidePanel, {
  SIDE_PANEL_DEFAULT_WIDTH,
  clampPanelWidth,
} from "../components/SidePanel";
import { usePersistedState } from "../components/usePersistedState";
import CollapsibleSection from "./CollapsibleSection";
import ROIControls from "./ROIControls";
import RoiContour from "./RoiContour";
import RoiHistogram from "./RoiHistogram";
import RoiProfiles, { type ProfilePair } from "./RoiProfiles";
import StatsPanel from "./StatsPanel";
import SummaryTiles from "./SummaryTiles";
import type { ColormapName } from "./colormaps";
import { contourLevels } from "./contourLevels";
import { PANEL_TABS } from "./panelIcons";
import { sampleProfile } from "./profileMetrics";
import { buildIsolines } from "./isolines";
import { extractRoiCrop } from "./roiCrop";
import type { ExportMeta } from "./roiExport";
import { cornerCutPx } from "./roiGeometry";
import type {
  ContourSettings,
  Isoline,
  ProfileOffset,
  ROIData,
  ROIStats,
  RoiMaskOptions,
  RoiSettings,
  RoiTab,
} from "./roiTypes";
import type { DoseMapData } from "./useDoseMap";

interface RoiPanelPrefs {
  collapsed: boolean;
  /** Expanded width in px. */
  width: number;
  tab: RoiTab;
  toolsOpen: boolean;
  contour: ContourSettings;
}

const PREFS_KEY = "filmdose.roiPanel.v1";
const DEFAULT_PREFS: RoiPanelPrefs = {
  collapsed: false,
  width: SIDE_PANEL_DEFAULT_WIDTH,
  tab: "stats",
  toolsOpen: true,
  contour: {
    mode: "percent",
    levels: 5,
    overlay: false,
    smooth: true,
    rangeMin: null,
    rangeMax: null,
    customPercent: null,
    customGy: null,
  },
};

interface RoiPanelProps {
  visible: boolean;
  settings: RoiSettings;
  onSettingsChange: (patch: Partial<RoiSettings>) => void;
  onCalculate: () => void;
  /** True until a dose map exists. */
  controlsDisabled: boolean;
  currentROI: ROIData | null;
  stats: ROIStats | null;
  statsLoading: boolean;
  statsError: string | null;
  doseMapData: DoseMapData | null;
  dpi: number;
  colormap: ColormapName;
  filmName: string | null;
  /** Isolines to draw on the main canvas, or null to clear them. */
  onOverlayIsolinesChange: (isolines: Isoline[] | null) => void;
  /** Where the profiles are taken, relative to the ROI centre (image px). */
  profileOffset: ProfileOffset;
  /** Whether the map should show the draggable profile crosshair. */
  onProfileCrosshairChange: (visible: boolean) => void;
}

const railButtonClass = (active: boolean) =>
  `inline-flex items-center justify-center w-8 h-8 rounded-md transition-colors ${
    active
      ? "bg-sky-600 text-white"
      : "text-slate-300 hover:bg-slate-600 hover:text-white"
  }`;

/**
 * The right-hand ROI analysis panel: ROI tools, summary tiles and the
 * Stats / Histogram / Contour / Profiles views. Owns its own display
 * preferences; everything about the ROI itself belongs to AnalysisPage.
 */
export default function RoiPanel({
  visible,
  settings,
  onSettingsChange,
  onCalculate,
  controlsDisabled,
  currentROI,
  stats,
  statsLoading,
  statsError,
  doseMapData,
  dpi,
  colormap,
  filmName,
  onOverlayIsolinesChange,
  profileOffset,
  onProfileCrosshairChange,
}: RoiPanelProps) {
  const [prefs, setPrefs] = usePersistedState<RoiPanelPrefs>(PREFS_KEY, DEFAULT_PREFS);
  const contour = useMemo<ContourSettings>(
    () => ({ ...DEFAULT_PREFS.contour, ...prefs.contour }),
    [prefs.contour]
  );
  const expanded = !prefs.collapsed;

  const {
    roiType,
    rotation,
    holeRatio,
    threshold,
    trimEnabled,
    trimPercent,
    cornerCutEnabled,
    cornerCutMm,
  } = settings;

  const maskOpts = useMemo<RoiMaskOptions>(
    () => ({
      roiType,
      holeRatio,
      threshold,
      cornerCutPx: cornerCutPx(roiType, cornerCutEnabled, cornerCutMm, dpi),
    }),
    [roiType, holeRatio, threshold, cornerCutEnabled, cornerCutMm, dpi]
  );

  const exportMeta = useMemo<ExportMeta>(
    () => ({
      filmName,
      roiType,
      trimEnabled,
      trimPercent,
      cornerCutMm: roiType === "Rectangle" && cornerCutEnabled ? cornerCutMm : 0,
      threshold,
    }),
    [filmName, roiType, trimEnabled, trimPercent, cornerCutEnabled, cornerCutMm, threshold]
  );

  // Key the client-side work on the dose array itself: `doseMapData` gets a
  // new identity on every colormap repaint, the pixels do not.
  const doseArray = doseMapData?.doseArray ?? null;
  const mapWidth = doseMapData?.width ?? 0;
  const mapHeight = doseMapData?.height ?? 0;

  const needCrop = contour.overlay || (expanded && prefs.tab === "contour");
  const crop = useMemo(
    () =>
      needCrop && doseArray && currentROI
        ? extractRoiCrop(doseArray, mapWidth, mapHeight, currentROI, maskOpts, dpi)
        : null,
    [needCrop, doseArray, mapWidth, mapHeight, currentROI, maskOpts, dpi]
  );

  // "95 %" means 95 % of the maximum the statistics report; the crop's own
  // maximum only bridges the moment before the server answers.
  const refMax = stats?.max ?? crop?.roiMax ?? null;
  const customLevels =
    contour.mode === "percent" ? contour.customPercent : contour.customGy;
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
  const isolines = useMemo(
    () => (crop && levels ? buildIsolines(crop, levels, contour.smooth) : null),
    [crop, levels, contour.smooth]
  );

  useEffect(() => {
    onOverlayIsolinesChange(contour.overlay ? isolines : null);
  }, [contour.overlay, isolines, onOverlayIsolinesChange]);
  useEffect(() => () => onOverlayIsolinesChange(null), [onOverlayIsolinesChange]);

  const needProfiles = expanded && prefs.tab === "profiles";
  const profiles = useMemo<ProfilePair | null>(
    () =>
      needProfiles && doseArray && currentROI
        ? {
            h: sampleProfile(doseArray, mapWidth, mapHeight, currentROI, maskOpts, dpi, "h", profileOffset),
            v: sampleProfile(doseArray, mapWidth, mapHeight, currentROI, maskOpts, dpi, "v", profileOffset),
          }
        : null,
    [needProfiles, doseArray, mapWidth, mapHeight, currentROI, maskOpts, dpi, profileOffset]
  );

  // The map shows the draggable crosshair only while the Profiles view is up
  useEffect(() => {
    onProfileCrosshairChange(needProfiles);
  }, [needProfiles, onProfileCrosshairChange]);
  useEffect(() => () => onProfileCrosshairChange(false), [onProfileCrosshairChange]);

  // Plotly only re-measures on window resize; the tab was 0x0 while hidden.
  useEffect(() => {
    if (visible) window.dispatchEvent(new Event("resize"));
  }, [visible]);

  const selectTab = (tab: RoiTab) =>
    setPrefs((p) => ({ ...p, collapsed: false, tab }));

  const rail = PANEL_TABS.map(({ key, label, Icon }) => (
    <button
      key={key}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={prefs.tab === key}
      onClick={() => selectTab(key)}
      className={railButtonClass(prefs.tab === key)}
    >
      <Icon size={18} />
    </button>
  ));

  const toolsSummary =
    roiType === "Rectangle" && rotation ? `${roiType} · ${rotation}°` : roiType;

  return (
    <SidePanel
      title="ROI Analysis"
      collapsed={prefs.collapsed}
      onCollapsedChange={(collapsed) => setPrefs((p) => ({ ...p, collapsed }))}
      width={clampPanelWidth(prefs.width ?? SIDE_PANEL_DEFAULT_WIDTH)}
      onWidthChange={(width) => setPrefs((p) => ({ ...p, width }))}
      rail={rail}
    >
      <CollapsibleSection
        title="ROI Tools"
        open={prefs.toolsOpen}
        onToggle={() => setPrefs((p) => ({ ...p, toolsOpen: !p.toolsOpen }))}
        summary={toolsSummary}
      >
        <ROIControls
          roiType={roiType}
          rotation={rotation}
          holeRatio={holeRatio}
          threshold={threshold}
          trimEnabled={trimEnabled}
          trimPercent={trimPercent}
          cornerCutEnabled={cornerCutEnabled}
          cornerCutMm={cornerCutMm}
          onROITypeChange={(v) => onSettingsChange({ roiType: v })}
          onRotationChange={(v) => onSettingsChange({ rotation: v })}
          onHoleRatioChange={(v) => onSettingsChange({ holeRatio: v })}
          onThresholdChange={(v) => onSettingsChange({ threshold: v })}
          onTrimEnabledChange={(v) => onSettingsChange({ trimEnabled: v })}
          onTrimPercentChange={(v) => onSettingsChange({ trimPercent: v })}
          onCornerCutEnabledChange={(v) => onSettingsChange({ cornerCutEnabled: v })}
          onCornerCutMmChange={(v) => onSettingsChange({ cornerCutMm: v })}
          onCalculate={onCalculate}
          disabled={controlsDisabled}
        />
      </CollapsibleSection>

      <SummaryTiles stats={stats} loading={statsLoading} />

      {statsError && (
        <p className="px-4 pt-3 text-xs text-red-400" role="alert">
          {statsError}
        </p>
      )}

      <div
        role="tablist"
        aria-label="ROI analysis views"
        className="mt-3 px-4 flex gap-1 border-b border-slate-600"
      >
        {PANEL_TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`roi-tab-${key}`}
            aria-selected={prefs.tab === key}
            aria-controls={`roi-tabpanel-${key}`}
            onClick={() => selectTab(key)}
            className={`-mb-px px-2.5 py-2 text-xs font-medium border-b-2 transition-colors ${
              prefs.tab === key
                ? "text-white border-sky-500"
                : "text-slate-400 border-transparent hover:text-slate-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`roi-tabpanel-${prefs.tab}`}
        aria-labelledby={`roi-tab-${prefs.tab}`}
      >
        {prefs.tab === "stats" && (
          <StatsPanel
            stats={stats}
            loading={statsLoading}
            hasError={statsError !== null}
            exportMeta={exportMeta}
          />
        )}
        {prefs.tab === "histogram" && (
          <RoiHistogram
            stats={stats}
            loading={statsLoading}
            exportMeta={exportMeta}
            filmName={filmName}
          />
        )}
        {prefs.tab === "contour" && (
          <RoiContour
            crop={crop}
            levels={levels}
            isolines={isolines}
            colormap={colormap}
            dpi={dpi}
            refMax={refMax}
            hasRoi={currentROI !== null && doseArray !== null}
            settings={contour}
            onSettingsChange={(patch) =>
              setPrefs((p) => ({ ...p, contour: { ...contour, ...patch } }))
            }
          />
        )}
        {prefs.tab === "profiles" && (
          <RoiProfiles
            profiles={profiles}
            hasRoi={currentROI !== null && doseArray !== null}
            exportMeta={exportMeta}
            filmName={filmName}
          />
        )}
      </div>
    </SidePanel>
  );
}
