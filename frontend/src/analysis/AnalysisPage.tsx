import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import client from "../api/client";
import { setSharedSession } from "../api/imageSession";
import {
  subscribePendingRestore,
  takePendingRestore,
  type RestorePayload,
} from "../api/analysisTransfer";
import CalibrationPanel, { type Profile } from "./CalibrationPanel";
import ImageCanvas, { type RoiChangeReason } from "./ImageCanvas";
import ColorBar from "./ColorBar";
import RoiPanel from "./RoiPanel";
import { useDoseMap } from "./useDoseMap";
import type { ColormapName } from "./colormaps";
import { ZERO_OFFSET, clampProfileOffset } from "./profileMetrics";
import type {
  Isoline,
  ProfileOffset,
  ROIData,
  ROIStats,
  ROIType,
  RoiSettings,
} from "./roiTypes";

interface ImageInfo {
  width: number;
  height: number;
  dpi: number;
  channels: number;
}

interface UploadResponse {
  session_id: string;
  width: number;
  height: number;
  dpi: number;
  channels: number;
}

interface ProjectSummary {
  id: number;
  name: string;
}

const COLORMAPS: ColormapName[] = ["jet", "viridis", "hot"];

/** Saved colormaps are plain strings in the database, so validate on the way in. */
function toColormap(value: string | null | undefined): ColormapName {
  return COLORMAPS.includes(value as ColormapName)
    ? (value as ColormapName)
    : "jet";
}

interface AppliedCalibration {
  profile_id: number | null;
  channel: string;
  a: number;
  b: number;
  c: number;
}

export default function AnalysisPage({ visible = true }: { visible?: boolean }) {
  // Session state
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [filmName, setFilmName] = useState<string | null>(null);
  const [isCalibrated, setIsCalibrated] = useState(false);
  const [calibrationVersion, setCalibrationVersion] = useState(0);

  // Profiles
  const [profiles, setProfiles] = useState<Profile[]>([]);

  // Projects (folders a saved analysis can belong to)
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);

  // Set when this session came from history, so saving can update that record
  const [savedAnalysisId, setSavedAnalysisId] = useState<number | null>(null);

  // Last-applied calibration params (needed for save)
  const [appliedCalibration, setAppliedCalibration] =
    useState<AppliedCalibration | null>(null);

  // Calibration and ROI handed to the child panels when restoring
  const [restoreCalibration, setRestoreCalibration] =
    useState<AppliedCalibration | null>(null);
  const [restoreVersion, setRestoreVersion] = useState(0);
  const [initialRoi, setInitialRoi] = useState<ROIData | null>(null);
  const [initialRoiVersion, setInitialRoiVersion] = useState(0);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  // ROI state
  const [roiType, setROIType] = useState<ROIType>("Rectangle");
  const [rotation, setRotation] = useState(0);
  const [holeRatio, setHoleRatio] = useState(50);
  const [threshold, setThreshold] = useState(0);
  const [trimEnabled, setTrimEnabled] = useState(false);
  const [trimPercent, setTrimPercent] = useState(2);
  const [cornerCutEnabled, setCornerCutEnabled] = useState(false);
  const [cornerCutMm, setCornerCutMm] = useState(3);
  const [currentROI, setCurrentROI] = useState<ROIData | null>(null);

  // Stats
  const [stats, setStats] = useState<ROIStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  // Isodose lines the ROI panel asks to draw on the map
  const [overlayIsolines, setOverlayIsolines] = useState<Isoline[] | null>(null);

  // Where the profiles are taken (offsets from the ROI centre, image px) and
  // whether the map should show the crosshair that moves them
  const [profileOffset, setProfileOffset] = useState<ProfileOffset>(ZERO_OFFSET);
  const [showProfileCrosshair, setShowProfileCrosshair] = useState(false);

  // UI state
  const [uploading, setUploading] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Colormap and dose range
  const [colormap, setColormap] = useState<ColormapName>("jet");
  const [cmapMin, setCmapMin] = useState(0);
  const [cmapMax, setCmapMax] = useState(10);

  // Cursor dose readout
  const [cursorDose, setCursorDose] = useState<{ dose: number; x: number; y: number } | null>(null);

  // Debounce ref
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // File input ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Blob URLs must be revoked by hand or the image bytes leak for the session
  const previewUrlRef = useRef<string | null>(null);
  const setPreview = useCallback((url: string | null) => {
    if (previewUrlRef.current && previewUrlRef.current !== url) {
      URL.revokeObjectURL(previewUrlRef.current);
    }
    previewUrlRef.current = url;
    setPreviewUrl(url);
  }, []);

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    []
  );

  // Fetch profiles
  const fetchProfiles = useCallback(() => {
    client
      .get<Profile[]>("/profiles")
      .then((res) => setProfiles(res.data))
      .catch(() => {});
  }, []);

  const fetchProjects = useCallback(() => {
    client
      .get<ProjectSummary[]>("/projects")
      .then((res) => setProjects(res.data))
      .catch(() => {});
  }, []);

  // Re-fetch profiles and projects when tab becomes visible
  useEffect(() => {
    if (!visible) return;
    fetchProfiles();
    fetchProjects();
  }, [visible, fetchProfiles, fetchProjects]);

  // Interactive dose map hook — cmapMin/cmapMax drive client-side re-coloring
  const { doseMapData, getDoseAt, canvasVersion } = useDoseMap({
    sessionId,
    isCalibrated,
    calibrationVersion,
    colormap,
    cmapMin,
    cmapMax,
  });

  // Cursor dose callback
  const handleCursorDose = useCallback(
    (dose: number | null, x: number, y: number) => {
      if (dose !== null) {
        setCursorDose({ dose, x, y });
      } else {
        setCursorDose(null);
      }
    },
    []
  );

  // Upload handler
  const handleUpload = useCallback(async (file: File) => {
    setUploading(true);
    setUploadError(null);
    setIsCalibrated(false);
    setStats(null);
    setStatsError(null);
    setOverlayIsolines(null);
    setCurrentROI(null);
    setProfileOffset(ZERO_OFFSET);
    // A new film starts a new study; the next save must not overwrite the
    // analysis that happened to be open before.
    setSavedAnalysisId(null);
    setRestoreError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await client.post<UploadResponse>("/analysis/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const data = res.data;
      setSessionId(data.session_id);
      setFilmName(file.name);
      setImageInfo({
        width: data.width,
        height: data.height,
        dpi: data.dpi,
        channels: data.channels,
      });

      // Fetch preview as blob via authenticated client
      const previewRes = await client.get(
        `/analysis/${data.session_id}/preview`,
        { responseType: "blob" }
      );
      const blobUrl = URL.createObjectURL(previewRes.data);
      setPreview(blobUrl);

      // Offer this image to the Image tab without coupling the two pages.
      setSharedSession({
        sessionId: data.session_id,
        filename: file.name,
        width: data.width,
        height: data.height,
        previewUrl: blobUrl,
        source: "analysis",
      });
    } catch (err: any) {
      setUploadError(
        err.response?.data?.detail || "Upload failed. Please try again."
      );
    } finally {
      setUploading(false);
    }
  }, [setPreview]);

  // Drop handler
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleUpload(file);
    },
    [handleUpload]
  );

  // Apply calibration
  const handleApplyCalibration = useCallback(
    async (params: {
      profile_id: number | null;
      channel: string;
      a: number;
      b: number;
      c: number;
      cmap_min: number;
      cmap_max: number;
    }) => {
      if (!sessionId) return;
      setCalibrating(true);

      try {
        await client.post(`/analysis/${sessionId}/calibrate`, params);

        // Bump version so useDoseMap re-fetches even if already calibrated
        setIsCalibrated(true);
        setCalibrationVersion((v) => v + 1);
        setStats(null);
        setStatsError(null);
        setAppliedCalibration({
          profile_id: params.profile_id,
          channel: params.channel,
          a: params.a,
          b: params.b,
          c: params.c,
        });
      } catch (err: any) {
        alert(err.response?.data?.detail || "Calibration failed.");
      } finally {
        setCalibrating(false);
      }
    },
    [sessionId]
  );

  // Reopen a saved analysis: the server has already rehydrated the film into a
  // fresh session, so this rebuilds the page state around it.
  const restoreFromSaved = useCallback(
    async (payload: RestorePayload) => {
      setRestoreError(null);
      setUploadError(null);
      setStats(null);
      setStatsError(null);
      setOverlayIsolines(null);
      setCurrentROI(null);
      setProfileOffset(ZERO_OFFSET);
      setIsCalibrated(false);

      setSessionId(payload.session_id);
      setFilmName(payload.original_filename ?? null);
      setSavedAnalysisId(payload.id);
      setProjectId(payload.project_id);
      setNotes(payload.notes || "");
      setImageInfo({
        width: payload.width,
        height: payload.height,
        dpi: payload.dpi,
        channels: payload.channels,
      });

      setColormap(toColormap(payload.colormap));
      setCmapMin(payload.cmap_min);
      setCmapMax(payload.cmap_max);

      const saved = payload.roi;
      if (saved) {
        setROIType(saved.roi_type as ROIType);
        setRotation(saved.rotation_deg);
        setHoleRatio(saved.hole_ratio);
        setThreshold(saved.threshold);
        setTrimEnabled(saved.trim_enabled);
        setTrimPercent(saved.trim_percent);
        setCornerCutEnabled(saved.corner_cut_enabled);
        if (saved.corner_cut_mm > 0) setCornerCutMm(saved.corner_cut_mm);
      }

      const calibration: AppliedCalibration = {
        profile_id: payload.profile_id,
        channel: payload.channel,
        a: payload.a,
        b: payload.b,
        c: payload.c,
      };
      setRestoreCalibration(calibration);
      setRestoreVersion((v) => v + 1);

      try {
        const previewRes = await client.get(
          `/analysis/${payload.session_id}/preview`,
          { responseType: "blob" }
        );
        setPreview(URL.createObjectURL(previewRes.data));
      } catch {
        setRestoreError("Could not load the film preview.");
      }

      setCalibrating(true);
      try {
        await client.post(`/analysis/${payload.session_id}/calibrate`, {
          ...calibration,
          cmap_min: payload.cmap_min,
          cmap_max: payload.cmap_max,
        });
        setIsCalibrated(true);
        setCalibrationVersion((v) => v + 1);
        setAppliedCalibration(calibration);

        // Only now is the dose map on its way; the canvas clears its ROI while
        // the preview loads, so restoring it any earlier would be discarded.
        if (saved) {
          const roi: ROIData = {
            x: saved.x,
            y: saved.y,
            w: saved.w,
            h: saved.h,
            rotation: saved.rotation_deg,
          };
          setCurrentROI(roi);
          setInitialRoi(roi);
          setInitialRoiVersion((v) => v + 1);
        }
      } catch (err: any) {
        setRestoreError(
          err.response?.data?.detail ||
            "Could not re-apply the saved calibration."
        );
      } finally {
        setCalibrating(false);
      }
    },
    [setPreview]
  );

  // Pick up an analysis reopened from the History tab
  useEffect(() => {
    const pending = takePendingRestore();
    if (pending) restoreFromSaved(pending);
    return subscribePendingRestore((payload) => {
      takePendingRestore();
      restoreFromSaved(payload);
    });
  }, [restoreFromSaved]);

  // Calculate ROI stats
  const calculateStats = useCallback(
    async (roi?: ROIData) => {
      const r = roi ?? currentROI;
      if (!sessionId || !isCalibrated || !r) return;

      setStatsLoading(true);
      try {
        const res = await client.post<ROIStats>(`/analysis/${sessionId}/roi`, {
          roi_type: roiType,
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.w),
          h: Math.round(r.h),
          rotation_deg: r.rotation,
          hole_ratio: holeRatio,
          threshold,
          dpi: imageInfo?.dpi ?? 72,
          trim_enabled: trimEnabled,
          trim_percent: trimPercent,
          corner_cut_enabled: roiType === "Rectangle" && cornerCutEnabled,
          corner_cut_mm: cornerCutMm,
        });
        setStats(res.data);
        setStatsError(null);
      } catch (err: any) {
        console.error("ROI stats error:", err);
        // Stale numbers would misdescribe the ROI that is actually on screen.
        setStats(null);
        setStatsError(
          err.response?.data?.detail || "Could not compute ROI statistics."
        );
      } finally {
        setStatsLoading(false);
      }
    },
    [
      sessionId,
      isCalibrated,
      currentROI,
      roiType,
      holeRatio,
      threshold,
      imageInfo,
      trimEnabled,
      trimPercent,
      cornerCutEnabled,
      cornerCutMm,
    ]
  );

  // ROI change callback (debounced)
  const handleROIChange = useCallback(
    (roi: ROIData, reason: RoiChangeReason) => {
      setCurrentROI(roi);

      // A fresh ROI starts with the profiles through its centre; a resize
      // just keeps the crosshair inside the box.
      setProfileOffset((prev) =>
        reason === "place" ? ZERO_OFFSET : clampProfileOffset(prev, roi)
      );

      // Keep the Rotation control in step with the Transformer handle. The
      // canvas snaps the rectangle to this whole-degree value in return.
      if (roiType === "Rectangle") {
        const deg = Math.round(roi.rotation) % 360;
        setRotation((prev) => (prev === deg ? prev : deg));
      }

      if (!isCalibrated) return;

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        calculateStats(roi);
      }, 300);
    },
    [isCalibrated, calculateStats, roiType]
  );

  // Recalculate stats when any pixel-selection option changes (debounced).
  // Rotation arrives through handleROIChange, since it moves the ROI itself.
  useEffect(() => {
    if (!isCalibrated || !currentROI) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      calculateStats();
    }, 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roiType, holeRatio, threshold, trimEnabled, trimPercent, cornerCutEnabled, cornerCutMm]);

  // Recompute stats for a restored ROI rather than trusting the stored numbers,
  // so what is shown always matches the dose map currently on screen.
  useEffect(() => {
    if (!initialRoiVersion || !isCalibrated || !initialRoi) return;
    calculateStats(initialRoi);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRoiVersion, isCalibrated]);

  // Save the analysis: the whole study, not just the calibration numbers.
  // `overwrite` updates the record this session was reopened from; otherwise a
  // new record is created (used for "Save as New" when comparing variations).
  const handleSave = useCallback(
    async (overwrite: boolean) => {
      if (!sessionId || !appliedCalibration) return;
      setSaving(true);
      setSaveSuccess(false);
      setSaveError(null);
      try {
        const res = await client.post<{ id: number }>(
          `/analysis/${sessionId}/save`,
          {
            profile_id: appliedCalibration.profile_id,
            channel: appliedCalibration.channel,
            a: appliedCalibration.a,
            b: appliedCalibration.b,
            c: appliedCalibration.c,
            cmap_min: cmapMin,
            cmap_max: cmapMax,
            colormap,
            notes,
            project_id: projectId,
            analysis_id: overwrite ? savedAnalysisId : null,
            roi: currentROI
              ? {
                  roi_type: roiType,
                  x: currentROI.x,
                  y: currentROI.y,
                  w: currentROI.w,
                  h: currentROI.h,
                  rotation_deg: currentROI.rotation,
                  hole_ratio: holeRatio,
                  threshold,
                  trim_enabled: trimEnabled,
                  trim_percent: trimPercent,
                  corner_cut_enabled:
                    roiType === "Rectangle" && cornerCutEnabled,
                  corner_cut_mm: cornerCutMm,
                }
              : null,
            stats: stats ?? null,
          }
        );
        // Further saves target the record just written, so repeated clicks of
        // "Update Saved" keep editing one analysis instead of piling up copies.
        setSavedAnalysisId(res.data.id);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      } catch (err: any) {
        setSaveError(
          err.response?.status === 404
            ? "This session expired. Re-upload the film or reopen it from History."
            : err.response?.data?.detail || "Failed to save the analysis."
        );
      } finally {
        setSaving(false);
      }
    },
    [
      sessionId,
      appliedCalibration,
      cmapMin,
      cmapMax,
      colormap,
      notes,
      projectId,
      savedAnalysisId,
      currentROI,
      roiType,
      holeRatio,
      threshold,
      trimEnabled,
      trimPercent,
      cornerCutEnabled,
      cornerCutMm,
      stats,
    ]
  );

  // The ROI panel edits these through one callback
  const roiSettings = useMemo<RoiSettings>(
    () => ({
      roiType,
      rotation,
      holeRatio,
      threshold,
      trimEnabled,
      trimPercent,
      cornerCutEnabled,
      cornerCutMm,
    }),
    [roiType, rotation, holeRatio, threshold, trimEnabled, trimPercent, cornerCutEnabled, cornerCutMm]
  );

  const handleProfileOffsetChange = useCallback(
    (offset: ProfileOffset) => {
      setProfileOffset(currentROI ? clampProfileOffset(offset, currentROI) : offset);
    },
    [currentROI]
  );

  const handleSettingsChange = useCallback((patch: Partial<RoiSettings>) => {
    if (patch.roiType !== undefined) setROIType(patch.roiType);
    if (patch.rotation !== undefined) setRotation(patch.rotation);
    if (patch.holeRatio !== undefined) setHoleRatio(patch.holeRatio);
    if (patch.threshold !== undefined) setThreshold(patch.threshold);
    if (patch.trimEnabled !== undefined) setTrimEnabled(patch.trimEnabled);
    if (patch.trimPercent !== undefined) setTrimPercent(patch.trimPercent);
    if (patch.cornerCutEnabled !== undefined) setCornerCutEnabled(patch.cornerCutEnabled);
    if (patch.cornerCutMm !== undefined) setCornerCutMm(patch.cornerCutMm);
  }, []);

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left Sidebar: the film and its calibration */}
      <aside className="w-80 bg-slate-700 flex flex-col overflow-y-auto flex-shrink-0 border-r border-slate-600">
        {/* Upload Section */}
        <div className="p-4 border-b border-slate-600">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Upload Film
          </h2>

          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-colors ${
              uploading
                ? "border-sky-500 bg-sky-900/20"
                : "border-slate-500 hover:border-sky-400 hover:bg-slate-600/50"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.tif,.tiff"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
              }}
            />

            {uploading ? (
              <div className="flex items-center justify-center gap-2">
                <svg
                  className="animate-spin h-5 w-5 text-sky-400"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                <span className="text-sm text-sky-400">Uploading...</span>
              </div>
            ) : (
              <>
                <svg
                  className="mx-auto h-8 w-8 text-slate-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                <p className="mt-2 text-xs text-slate-400">
                  Drop film image here or click to browse
                </p>
              </>
            )}
          </div>

          {uploadError && (
            <p className="mt-2 text-xs text-red-400">{uploadError}</p>
          )}

          {restoreError && (
            <p className="mt-2 text-xs text-red-400">{restoreError}</p>
          )}

          {imageInfo && (
            <div className="mt-3 text-xs text-slate-400 space-y-0.5">
              {filmName && (
                <p className="text-slate-300 truncate" title={filmName}>
                  {filmName}
                </p>
              )}
              <p>
                {imageInfo.width} x {imageInfo.height} px | {imageInfo.dpi} DPI
              </p>
              <p>{imageInfo.channels} channel{imageInfo.channels > 1 ? "s" : ""}</p>
              {isCalibrated && (
                <span className="inline-block mt-1 px-2 py-0.5 bg-emerald-900/50 text-emerald-400 text-xs rounded-full border border-emerald-700">
                  Calibrated
                </span>
              )}
            </div>
          )}
        </div>

        {/* Calibration Section */}
        <CalibrationPanel
          profiles={profiles}
          onApplyCalibration={handleApplyCalibration}
          onProfilesChange={fetchProfiles}
          disabled={!sessionId}
          loading={calibrating}
          cmapMin={cmapMin}
          cmapMax={cmapMax}
          onCmapMinChange={setCmapMin}
          onCmapMaxChange={setCmapMax}
          restoreCalibration={restoreCalibration}
          restoreVersion={restoreVersion}
        />

        {/* Save section */}
        {sessionId && appliedCalibration && (
          <div className="p-4 border-t border-slate-600 mt-auto">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Save Analysis
            </h2>

            {savedAnalysisId !== null && (
              <p className="mb-2 text-xs text-sky-300">
                Continuing saved analysis #{savedAnalysisId}
              </p>
            )}

            <label className="block text-xs text-slate-400 mb-1">Project</label>
            <select
              value={projectId ?? ""}
              onChange={(e) =>
                setProjectId(e.target.value ? Number(e.target.value) : null)
              }
              className="w-full px-2 py-1.5 text-sm bg-slate-800 border border-slate-600 rounded text-slate-200 mb-2"
            >
              <option value="">Unfiled</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Analysis notes..."
              rows={3}
              title="Drag the corner to make this box taller"
              className="w-full px-2 py-1.5 text-sm bg-slate-800 border border-slate-600 rounded text-slate-200 placeholder-slate-500 resize-y min-h-[4.5rem] max-h-80 mb-2"
            />

            {!currentROI && (
              <p className="mb-2 text-xs text-amber-400">
                No ROI placed — the analysis will be saved without measurements.
              </p>
            )}

            <div className="flex gap-2">
              {savedAnalysisId !== null && (
                <button
                  onClick={() => handleSave(true)}
                  disabled={saving}
                  className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                    saving
                      ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                      : saveSuccess
                        ? "bg-emerald-600 text-white"
                        : "bg-sky-600 hover:bg-sky-500 text-white"
                  }`}
                >
                  {saving ? "Saving..." : saveSuccess ? "Saved" : "Update Saved"}
                </button>
              )}
              <button
                onClick={() => handleSave(false)}
                disabled={saving}
                className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                  saving
                    ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                    : saveSuccess && savedAnalysisId === null
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-600 hover:bg-slate-500 text-slate-200"
                }`}
              >
                {savedAnalysisId !== null ? "Save as New" : "Save Analysis"}
              </button>
            </div>

            {saveError && (
              <p className="mt-2 text-xs text-red-400">{saveError}</p>
            )}
          </div>
        )}
      </aside>

      {/* Main Canvas Area */}
      <div className="flex-1 min-w-0 relative">
        <ImageCanvas
          imageUrl={previewUrl}
          doseMapCanvas={doseMapData?.canvas ?? null}
          doseMapWidth={doseMapData?.width}
          doseMapHeight={doseMapData?.height}
          canvasVersion={canvasVersion}
          roiType={roiType}
          rotation={rotation}
          holeRatio={holeRatio}
          cornerCutEnabled={cornerCutEnabled}
          cornerCutMm={cornerCutMm}
          dpi={imageInfo?.dpi ?? 72}
          onROIChange={handleROIChange}
          onCursorDose={handleCursorDose}
          getDoseAt={getDoseAt}
          initialRoi={initialRoi}
          initialRoiVersion={initialRoiVersion}
          isolines={overlayIsolines}
          profileCrosshair={showProfileCrosshair && currentROI ? profileOffset : null}
          onProfileOffsetChange={handleProfileOffsetChange}
        />

        {/* Cursor dose readout overlay */}
        {cursorDose && (
          <div className="absolute top-3 left-3 bg-slate-800/90 border border-slate-600 rounded-lg px-3 py-2 text-sm font-mono pointer-events-none">
            <span className="text-slate-400">Dose: </span>
            <span className="text-sky-300 font-semibold">
              {cursorDose.dose.toFixed(3)} Gy
            </span>
            <span className="text-slate-500 ml-2 text-xs">
              ({Math.round(cursorDose.x)}, {Math.round(cursorDose.y)})
            </span>
          </div>
        )}

        {/* Dose color bar legend */}
        {doseMapData && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <ColorBar
              colormap={colormap}
              cmapMin={cmapMin}
              cmapMax={cmapMax}
            />
          </div>
        )}

        {/* Colormap selector */}
        {isCalibrated && (
          <div className="absolute bottom-3 right-3 bg-slate-800/90 border border-slate-600 rounded-lg px-2 py-1.5 flex items-center gap-2">
            <span className="text-xs text-slate-400">Colormap:</span>
            {COLORMAPS.map((cm) => (
              <button
                key={cm}
                onClick={() => setColormap(cm)}
                className={`px-2 py-0.5 text-xs rounded transition-colors ${
                  colormap === cm
                    ? "bg-sky-600 text-white"
                    : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                }`}
              >
                {cm}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right panel: ROI tools and analysis views */}
      <RoiPanel
        visible={visible}
        settings={roiSettings}
        onSettingsChange={handleSettingsChange}
        onCalculate={() => calculateStats()}
        controlsDisabled={!isCalibrated}
        currentROI={currentROI}
        stats={stats}
        statsLoading={statsLoading}
        statsError={statsError}
        doseMapData={doseMapData}
        dpi={imageInfo?.dpi ?? 72}
        colormap={colormap}
        filmName={filmName}
        onOverlayIsolinesChange={setOverlayIsolines}
        profileOffset={profileOffset}
        onProfileCrosshairChange={setShowProfileCrosshair}
      />
    </div>
  );
}
