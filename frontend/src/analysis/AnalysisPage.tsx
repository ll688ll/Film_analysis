import { useState, useEffect, useCallback, useRef } from "react";
import client from "../api/client";
import CalibrationPanel, { type Profile } from "./CalibrationPanel";
import ROIControls, { type ROIType } from "./ROIControls";
import StatsPanel, { type ROIStats } from "./StatsPanel";
import ImageCanvas from "./ImageCanvas";
import { useDoseMap } from "./useDoseMap";
import type { ColormapName } from "./colormaps";

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

interface ROIData {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

export default function AnalysisPage() {
  // Session state
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isCalibrated, setIsCalibrated] = useState(false);
  const [calibrationVersion, setCalibrationVersion] = useState(0);

  // Profiles
  const [profiles, setProfiles] = useState<Profile[]>([]);

  // ROI state
  const [roiType, setROIType] = useState<ROIType>("Rectangle");
  const [rotation, setRotation] = useState(0);
  const [holeRatio, setHoleRatio] = useState(50);
  const [threshold, setThreshold] = useState(0);
  const [currentROI, setCurrentROI] = useState<ROIData | null>(null);

  // Stats
  const [stats, setStats] = useState<ROIStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // UI state
  const [uploading, setUploading] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

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

  // Fetch profiles on mount
  useEffect(() => {
    client
      .get<Profile[]>("/profiles")
      .then((res) => setProfiles(res.data))
      .catch(() => {});
  }, []);

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
    setCurrentROI(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await client.post<UploadResponse>("/analysis/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const data = res.data;
      setSessionId(data.session_id);
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
      setPreviewUrl(blobUrl);
    } catch (err: any) {
      setUploadError(
        err.response?.data?.detail || "Upload failed. Please try again."
      );
    } finally {
      setUploading(false);
    }
  }, []);

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
      profile_id: number;
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
      } catch (err: any) {
        alert(err.response?.data?.detail || "Calibration failed.");
      } finally {
        setCalibrating(false);
      }
    },
    [sessionId]
  );

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
        });
        setStats(res.data);
      } catch (err: any) {
        console.error("ROI stats error:", err);
      } finally {
        setStatsLoading(false);
      }
    },
    [sessionId, isCalibrated, currentROI, roiType, holeRatio, threshold, imageInfo]
  );

  // ROI change callback (debounced)
  const handleROIChange = useCallback(
    (roi: ROIData) => {
      setCurrentROI(roi);

      if (!isCalibrated) return;

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        calculateStats(roi);
      }, 300);
    },
    [isCalibrated, calculateStats]
  );

  // Save session
  const handleSave = useCallback(async () => {
    if (!sessionId) return;
    setSaving(true);
    setSaveSuccess(false);
    try {
      await client.post(`/analysis/${sessionId}/save`, { notes });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch {
      alert("Failed to save session.");
    } finally {
      setSaving(false);
    }
  }, [sessionId, notes]);

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left Sidebar */}
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

          {imageInfo && (
            <div className="mt-3 text-xs text-slate-400 space-y-0.5">
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
          disabled={!sessionId}
          loading={calibrating}
          cmapMin={cmapMin}
          cmapMax={cmapMax}
          onCmapMinChange={setCmapMin}
          onCmapMaxChange={setCmapMax}
        />

        {/* ROI Controls */}
        <ROIControls
          roiType={roiType}
          rotation={rotation}
          holeRatio={holeRatio}
          threshold={threshold}
          onROITypeChange={setROIType}
          onRotationChange={setRotation}
          onHoleRatioChange={setHoleRatio}
          onThresholdChange={setThreshold}
          onCalculate={() => calculateStats()}
          disabled={!isCalibrated}
        />

        {/* Statistics */}
        <StatsPanel stats={stats} loading={statsLoading} />

        {/* Save section */}
        {sessionId && (
          <div className="p-4 border-t border-slate-600 mt-auto">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Session
            </h2>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Session notes..."
              rows={2}
              className="w-full px-2 py-1.5 text-sm bg-slate-800 border border-slate-600 rounded text-slate-200 placeholder-slate-500 resize-none mb-2"
            />
            <button
              onClick={handleSave}
              disabled={saving}
              className={`w-full px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                saving
                  ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                  : saveSuccess
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-600 hover:bg-slate-500 text-slate-200"
              }`}
            >
              {saving ? "Saving..." : saveSuccess ? "Saved" : "Save Session"}
            </button>
          </div>
        )}
      </aside>

      {/* Main Canvas Area */}
      <div className="flex-1 relative">
        <ImageCanvas
          imageUrl={previewUrl}
          doseMapCanvas={doseMapData?.canvas ?? null}
          doseMapWidth={doseMapData?.width}
          doseMapHeight={doseMapData?.height}
          canvasVersion={canvasVersion}
          roiType={roiType}
          rotation={rotation}
          holeRatio={holeRatio}
          onROIChange={handleROIChange}
          onCursorDose={handleCursorDose}
          getDoseAt={getDoseAt}
        />

        {/* Cursor dose readout overlay */}
        {cursorDose && (
          <div className="absolute top-3 right-3 bg-slate-800/90 border border-slate-600 rounded-lg px-3 py-2 text-sm font-mono pointer-events-none">
            <span className="text-slate-400">Dose: </span>
            <span className="text-sky-300 font-semibold">
              {cursorDose.dose.toFixed(3)} Gy
            </span>
            <span className="text-slate-500 ml-2 text-xs">
              ({Math.round(cursorDose.x)}, {Math.round(cursorDose.y)})
            </span>
          </div>
        )}

        {/* Colormap selector */}
        {isCalibrated && (
          <div className="absolute bottom-3 right-3 bg-slate-800/90 border border-slate-600 rounded-lg px-2 py-1.5 flex items-center gap-2">
            <span className="text-xs text-slate-400">Colormap:</span>
            {(["jet", "viridis", "hot"] as ColormapName[]).map((cm) => (
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
    </div>
  );
}
