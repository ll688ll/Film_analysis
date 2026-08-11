import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import client from "../api/client";
import {
  getSharedSession,
  setSharedSession,
  subscribeSharedSession,
  type SharedImageSession,
} from "../api/imageSession";
import ImageCanvasView from "./ImageCanvasView";
import ImageToolbar from "./ImageToolbar";
import IntensityHistogram, { type HistogramMode } from "./IntensityHistogram";
import IntensityPalette from "./IntensityPalette";
import LevelControls from "./LevelControls";
import LevelTable from "./LevelTable";
import WindowLevelPanel from "./WindowLevelPanel";
import {
  fullRangeWL,
  type BackdropMode,
  type WindowLevel,
} from "./windowLevel";
import {
  baseName,
  copyToClipboard,
  downloadCSV,
  exportCanvasPNG,
  levelsToCSV,
  levelsToTSV,
} from "./exporters";
import {
  edgesToBounds,
  equalCountEdges,
  equalWidthEdges,
  levelStatsFromHistogram,
  levelsFromBounds,
  levelForBin,
} from "./intensityStats";
import { presetColors } from "./levelColors";
import { useIntensityData } from "./useIntensityData";
import type {
  AnalyzeResponse,
  BinningMethod,
  ImageMeta,
  IntensitySource,
  Level,
  LevelStat,
  ROIRect,
  ThresholdsResponse,
} from "./types";

interface ImageAnalysisPageProps {
  visible?: boolean;
}

type RgbHists = Record<"Red" | "Green" | "Blue", AnalyzeResponse | null>;

export default function ImageAnalysisPage({ visible = true }: ImageAnalysisPageProps) {
  // --- Session -----------------------------------------------------------
  const [meta, setMeta] = useState<ImageMeta | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [baseImage, setBaseImage] = useState<HTMLImageElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [shared, setShared] = useState<SharedImageSession | null>(getSharedSession());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  // --- Analysis parameters ----------------------------------------------
  const [source, setSource] = useState<IntensitySource>("Gray");
  const [bins, setBins] = useState(256);
  const [levelCount, setLevelCount] = useState(4);
  const [method, setMethod] = useState<BinningMethod>("otsu");
  /** The last automatic method chosen, restored when levels must be rebuilt. */
  const [lastAutoMethod, setLastAutoMethod] = useState<BinningMethod>("otsu");
  const builtForRef = useRef<string | null>(null);
  const [valueMin, setValueMin] = useState<number | null>(null);
  const [valueMax, setValueMax] = useState<number | null>(null);
  const [excludeZero, setExcludeZero] = useState(false);
  const [ignoreTransparent, setIgnoreTransparent] = useState(false);
  const [roiEnabled, setRoiEnabled] = useState(false);
  const [roi, setRoi] = useState<ROIRect | null>(null);

  // --- Presentation ------------------------------------------------------
  const [levels, setLevels] = useState<Level[]>([]);
  const [preset, setPreset] = useState("viridis");
  const [reverse, setReverse] = useState(false);
  const [isolate, setIsolate] = useState<number | null>(null);
  const [overlayOpacity, setOverlayOpacity] = useState(1);
  const [histMode, setHistMode] = useState<HistogramMode>("levels");
  // Display-only transfer function; never feeds back into the analysis.
  const [wl, setWl] = useState<WindowLevel>({ level: 128, window: 256, invert: false });
  const [backdrop, setBackdrop] = useState<BackdropMode>("original");

  // --- Derived / async ---------------------------------------------------
  const [exactStats, setExactStats] = useState<Record<number, LevelStat["exact"]> | null>(null);
  const [exactLoading, setExactLoading] = useState(false);
  const [rgbHists, setRgbHists] = useState<RgbHists | null>(null);
  const [rgbLoading, setRgbLoading] = useState(false);
  const [zoomState, setZoomState] = useState({ zoom: 1, isFit: true });
  const [probe, setProbe] = useState<{ x: number; y: number } | null>(null);
  const controlsRef = useRef<{ zoomIn: () => void; zoomOut: () => void; fit: () => void }>({
    zoomIn: () => {},
    zoomOut: () => {},
    fit: () => {},
  });

  const sessionId = meta?.session_id ?? null;

  const {
    hist,
    prefix,
    canvas,
    canvasVersion,
    downsample,
    loading,
    error,
    getCodeAt,
    getValueAt,
  } = useIntensityData({
    sessionId,
    source,
    bins,
    valueMin,
    valueMax,
    excludeZero,
    ignoreTransparent,
    roi: roiEnabled ? roi : null,
    visible,
    levels,
    isolate,
    overlayOpacity,
    baseImage,
    windowLevel: wl,
    backdrop,
  });

  useEffect(() => subscribeSharedSession(setShared), []);

  // --- Upload ------------------------------------------------------------

  const loadSession = useCallback(
    async (id: string, info: Omit<ImageMeta, "session_id">) => {
      setMeta({ session_id: id, ...info });
      setLevels([]);
      setExactStats(null);
      setRgbHists(null);
      setRoi(null);

      try {
        const res = await client.get(`/analysis/${id}/preview`, {
          responseType: "blob",
        });
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        const url = URL.createObjectURL(res.data);
        previewUrlRef.current = url;
        setPreviewUrl(url);
      } catch {
        setPreviewUrl(null);
      }
    },
    []
  );

  const handleFile = useCallback(
    async (file: File) => {
      setUploading(true);
      setUploadError(null);
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await client.post<ImageMeta>("/imaging/upload", form, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        const data = res.data;

        // Colour sources are unavailable on a grayscale image.
        if (data.channels < 3 && source !== "Gray" && source !== "Mean") {
          setSource("Gray");
        }
        setIgnoreTransparent(data.has_alpha);

        await loadSession(data.session_id, data);
        setSharedSession({
          sessionId: data.session_id,
          filename: data.filename,
          width: data.width,
          height: data.height,
          previewUrl: null,
          source: "imaging",
        });
      } catch (err: any) {
        setUploadError(err.response?.data?.detail || "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [loadSession, source]
  );

  const handleUseShared = useCallback(async () => {
    if (!shared) return;
    setUploading(true);
    setUploadError(null);
    try {
      // The other tab's session already holds the pixels; just describe it.
      const res = await client.post<AnalyzeResponse>(
        `/imaging/${shared.sessionId}/analyze`,
        { source: "Gray", bins }
      );
      const a = res.data;
      await loadSession(shared.sessionId, {
        filename: shared.filename,
        width: a.width,
        height: a.height,
        dpi: a.dpi,
        has_dpi: a.has_dpi,
        channels: a.channels,
        mode: "",
        original_mode: "",
        dtype: a.dtype,
        max_possible: a.max_possible,
        has_alpha: a.has_alpha,
        n_frames: 1,
      });
      if (a.channels < 3) setSource("Gray");
    } catch (err: any) {
      setUploadError(
        err.response?.status === 404
          ? "That session has expired — please upload the image here."
          : err.response?.data?.detail || "Could not load that image"
      );
    } finally {
      setUploading(false);
    }
  }, [shared, bins, loadSession]);

  // Decode the preview into an <img> for the overlay blend.
  useEffect(() => {
    if (!previewUrl) {
      setBaseImage(null);
      return;
    }
    const img = new window.Image();
    img.onload = () => setBaseImage(img);
    img.src = previewUrl;
  }, [previewUrl]);

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    []
  );

  // --- Level construction -------------------------------------------------

  const applyBounds = useCallback(
    (bounds: number[]) => {
      const colors = presetColors(preset, bounds.length - 1, reverse);
      setLevels((prev) => levelsFromBounds(bounds, colors, prev));
      setExactStats(null);
    },
    [preset, reverse]
  );

  /** Recompute boundaries whenever the analysis or the method changes. */
  const recomputeLevels = useCallback(
    async (targetMethod: BinningMethod, count: number) => {
      if (!hist || !sessionId) return;

      if (targetMethod === "equal_width") {
        applyBounds(edgesToBounds(equalWidthEdges(hist.bins, count), hist.bins));
        return;
      }
      if (targetMethod === "equal_count") {
        applyBounds(edgesToBounds(equalCountEdges(hist, count), hist.bins));
        return;
      }
      if (targetMethod === "manual") return;

      try {
        const res = await client.post<ThresholdsResponse>(
          `/imaging/${sessionId}/thresholds`,
          {
            source,
            bins,
            value_min: valueMin,
            value_max: valueMax,
            exclude_zero: excludeZero,
            ignore_transparent: ignoreTransparent,
            roi: roiEnabled && roi
              ? { roi_type: "Rectangle", x: roi.x, y: roi.y, w: roi.w, h: roi.h }
              : null,
            levels: count,
            method: targetMethod,
          }
        );
        applyBounds(res.data.bound_bins);
      } catch {
        // Fall back to a boundary set that needs no server.
        applyBounds(edgesToBounds(equalWidthEdges(hist.bins, count), hist.bins));
      }
    },
    [
      hist, sessionId, source, bins, valueMin, valueMax,
      excludeZero, ignoreTransparent, roiEnabled, roi, applyBounds,
    ]
  );

  // Rebuild levels when the histogram or the requested level count changes.
  const histKey = hist
    ? `${hist.source}:${hist.bins}:${hist.value_min}:${hist.value_max}:${hist.total_count}`
    : null;

  useEffect(() => {
    if (!histKey) return;
    const signature = `${histKey}|${levelCount}`;
    // A hand-dragged boundary flips the method to "manual"; don't undo it.
    // A genuinely new histogram or level count still rebuilds, using the last
    // automatic method the user chose.
    if (method === "manual" && builtForRef.current === signature) return;
    builtForRef.current = signature;
    recomputeLevels(method === "manual" ? lastAutoMethod : method, levelCount);
    // recomputeLevels changes with every analysis dependency; keying on the
    // resolved histogram avoids a second pass for an identical result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [histKey, levelCount, method]);

  // Reset the display ramp whenever the underlying value range changes
  // (new image, or a different source channel).
  const wlKey = hist ? `${hist.source}:${hist.data_min}:${hist.data_max}` : null;
  useEffect(() => {
    if (!hist) return;
    setWl(fullRangeWL(hist.data_min, hist.data_max));
    setBackdrop("original");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wlKey]);

  // Recolour without touching boundaries when the preset changes.
  useEffect(() => {
    setLevels((prev) => {
      if (prev.length === 0) return prev;
      const colors = presetColors(preset, prev.length, reverse);
      return prev.map((l, i) =>
        l.customColor ? l : { ...l, color: colors[i] ?? l.color }
      );
    });
  }, [preset, reverse]);

  // --- Statistics ---------------------------------------------------------

  const stats: LevelStat[] = useMemo(() => {
    if (!hist || !prefix || levels.length === 0) return [];
    const base = levelStatsFromHistogram(hist, prefix, levels);
    if (!exactStats) return base;
    return base.map((s) => ({ ...s, exact: exactStats[s.index] }));
  }, [hist, prefix, levels, exactStats]);

  const handleRequestExact = useCallback(async () => {
    if (!hist || !sessionId || levels.length === 0) return;
    setExactLoading(true);
    try {
      const bounds = [...levels.map((l) => l.loBin), levels[levels.length - 1].hiBin + 1];
      const edges = bounds.map((b) => hist.value_min + b * hist.bin_width);
      const res = await client.post(`/imaging/${sessionId}/level-stats`, {
        source,
        edges,
        exclude_zero: excludeZero,
        ignore_transparent: ignoreTransparent,
        roi: roiEnabled && roi
          ? { roi_type: "Rectangle", x: roi.x, y: roi.y, w: roi.w, h: roi.h }
          : null,
      });
      const map: Record<number, LevelStat["exact"]> = {};
      for (const l of res.data.levels) {
        map[l.index] = { mean: l.mean, std: l.std, min: l.min, max: l.max };
      }
      setExactStats(map);
    } catch {
      setExactStats(null);
    } finally {
      setExactLoading(false);
    }
  }, [hist, sessionId, levels, source, excludeZero, ignoreTransparent, roiEnabled, roi]);

  // Per-channel histograms for the RGB chart, fetched once per session.
  useEffect(() => {
    if (histMode !== "rgb" || !sessionId || !meta || meta.channels < 3) return;
    if (rgbHists) return;

    let cancelled = false;
    setRgbLoading(true);
    Promise.all(
      (["Red", "Green", "Blue"] as const).map((ch) =>
        client
          .post<AnalyzeResponse>(`/imaging/${sessionId}/analyze`, { source: ch, bins })
          .then((r) => r.data)
          .catch(() => null)
      )
    )
      .then(([Red, Green, Blue]) => {
        if (!cancelled) setRgbHists({ Red, Green, Blue });
      })
      .finally(() => {
        if (!cancelled) setRgbLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [histMode, sessionId, meta, bins, rgbHists]);

  // --- Handlers -----------------------------------------------------------

  const handleLevelColorChange = useCallback((index: number, color: string) => {
    setLevels((prev) =>
      prev.map((l) => (l.index === index ? { ...l, color, customColor: true } : l))
    );
  }, []);

  const handleToggleVisible = useCallback((index: number) => {
    setLevels((prev) =>
      prev.map((l) => (l.index === index ? { ...l, visible: !l.visible } : l))
    );
  }, []);

  const handleRoiChange = useCallback((next: ROIRect | null) => {
    setRoi(next);
  }, []);

  /**
   * Move interior boundary *i* to *bin*, keeping boundaries strictly
   * increasing. Storing bin indices is what keeps the derived statistics
   * exact after a hand edit.
   */
  const handleBoundaryChange = useCallback(
    (boundaryIndex: number, bin: number) => {
      setLevels((prev) => {
        if (prev.length < 2) return prev;
        const totalBins = prev[prev.length - 1].hiBin + 1;
        const lowerLimit = boundaryIndex === 0 ? 1 : prev[boundaryIndex].loBin + 1;
        const upperLimit =
          boundaryIndex === prev.length - 2
            ? totalBins - 1
            : prev[boundaryIndex + 2].loBin - 1;

        const clamped = Math.max(lowerLimit, Math.min(upperLimit, Math.round(bin)));
        if (clamped === prev[boundaryIndex + 1].loBin) return prev;

        const next = prev.map((l) => ({ ...l }));
        next[boundaryIndex].hiBin = clamped - 1;
        next[boundaryIndex + 1].loBin = clamped;
        return next;
      });
      setMethod("manual");
      setExactStats(null);
    },
    []
  );

  const handleExportCsv = useCallback(() => {
    if (!hist || !meta) return;
    const csv = levelsToCSV(levels, stats, hist, meta.filename);
    downloadCSV(csv, `${baseName(meta.filename)}_levels.csv`);
  }, [hist, meta, levels, stats]);

  const handleCopyTsv = useCallback(async () => {
    if (!hist) return;
    await copyToClipboard(levelsToTSV(levels, stats, hist));
  }, [hist, levels, stats]);

  const handleExportPng = useCallback(() => {
    if (!meta) return;
    exportCanvasPNG(canvas, `${baseName(meta.filename)}_levels.png`);
  }, [canvas, meta]);

  const handleControls = useCallback(
    (c: { zoomIn: () => void; zoomOut: () => void; fit: () => void }) => {
      controlsRef.current = c;
    },
    []
  );

  const probeInfo = useMemo(() => {
    if (!probe || !hist) return null;
    const code = getCodeAt(probe.x, probe.y);
    const value = getValueAt(probe.x, probe.y);
    const level = code === null ? null : levelForBin(levels, code);
    return { x: Math.floor(probe.x), y: Math.floor(probe.y), value, level };
  }, [probe, hist, getCodeAt, getValueAt, levels]);

  // --- Render -------------------------------------------------------------

  const busy = !meta || uploading;

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* LEFT: the image */}
      <div className="flex-1 relative">
        <ImageCanvasView
          baseImage={baseImage}
          levelCanvas={canvas}
          canvasVersion={canvasVersion}
          imageWidth={meta?.width ?? 0}
          imageHeight={meta?.height ?? 0}
          roiEnabled={roiEnabled}
          roi={roi}
          onROIChange={handleRoiChange}
          onProbe={setProbe}
          onTransform={setZoomState}
          onControls={handleControls}
        />

        {probeInfo && (
          <div className="absolute top-3 left-3 px-3 py-2 rounded-lg bg-slate-900/85 backdrop-blur border border-slate-700 font-mono text-xs text-slate-200 pointer-events-none">
            <div>
              {source}: {probeInfo.value === null ? "—" : probeInfo.value.toFixed(2)}
              <span className="text-slate-500">
                {" "}
                ({probeInfo.x}, {probeInfo.y})
              </span>
            </div>
            {probeInfo.level && (
              <div className="flex items-center gap-1.5 mt-1">
                <span
                  className="inline-block w-3 h-3 rounded-sm border border-slate-500"
                  style={{ backgroundColor: probeInfo.level.color }}
                />
                <span>{probeInfo.level.label}</span>
              </div>
            )}
          </div>
        )}

        {meta && (
          <ImageToolbar
            zoom={zoomState.zoom}
            onZoomIn={() => controlsRef.current.zoomIn()}
            onZoomOut={() => controlsRef.current.zoomOut()}
            onFit={() => controlsRef.current.fit()}
            overlayOpacity={overlayOpacity}
            onOverlayOpacityChange={setOverlayOpacity}
            roiEnabled={roiEnabled}
            onRoiEnabledChange={setRoiEnabled}
            hasRoi={roi !== null}
            onClearRoi={() => setRoi(null)}
            onExportPng={handleExportPng}
            downsample={downsample}
            disabled={!meta}
          />
        )}

        {error && (
          <div className="absolute top-3 right-3 px-3 py-2 rounded-lg bg-red-900/80 border border-red-700 text-xs text-red-100 max-w-xs">
            {error}
          </div>
        )}
      </div>

      {/* RIGHT: the tools */}
      <aside className="w-96 bg-slate-700 flex flex-col overflow-y-auto flex-shrink-0 border-l border-slate-600">
        {/* Upload */}
        <div className="p-4 border-b border-slate-600">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Image
          </h2>

          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files?.[0];
              if (file) handleFile(file);
            }}
            className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-colors ${
              dragOver
                ? "border-sky-400 bg-sky-950/30"
                : "border-slate-500 hover:border-slate-400"
            }`}
          >
            {uploading ? (
              <div className="flex items-center justify-center">
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
                <span className="ml-2 text-sm text-slate-400">Uploading…</span>
              </div>
            ) : (
              <>
                <p className="text-sm text-slate-300">
                  Drop an image or click to browse
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  PNG, JPEG, TIFF, BMP, GIF, WebP
                </p>
              </>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.tif,.tiff,.bmp,.gif,.webp,.tga,.ppm,.pgm"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
          />

          {shared && shared.sessionId !== sessionId && (
            <button
              type="button"
              onClick={handleUseShared}
              className="mt-2 w-full px-3 py-1.5 text-xs bg-slate-800 border border-slate-600 rounded text-slate-300 hover:bg-slate-600"
            >
              Use “{shared.filename}” from the {shared.source === "analysis" ? "Film Dose" : "Image"} tab
            </button>
          )}

          {uploadError && (
            <p className="mt-2 text-xs text-red-400">{uploadError}</p>
          )}

          {meta && (
            <div className="mt-3 text-xs text-slate-400 space-y-0.5">
              <div className="text-slate-300 truncate" title={meta.filename}>
                {meta.filename}
              </div>
              <div>
                {meta.width} × {meta.height} px ·{" "}
                {meta.channels === 1 ? "grayscale" : `${meta.channels} ch`} ·{" "}
                {meta.dtype}
              </div>
              <div>
                {meta.has_dpi ? `${meta.dpi.toFixed(0)} DPI` : "No DPI in file"}
                {meta.has_alpha && " · has alpha"}
                {meta.n_frames > 1 && ` · frame 1 of ${meta.n_frames}`}
              </div>
              {meta.original_mode && meta.original_mode !== meta.mode && (
                <div className="text-slate-500">
                  Converted {meta.original_mode} → {meta.mode}
                </div>
              )}
            </div>
          )}
        </div>

        <LevelControls
          source={source}
          onSourceChange={setSource}
          channels={meta?.channels ?? 0}
          levelCount={levelCount}
          onLevelCountChange={setLevelCount}
          method={method}
          onMethodChange={(m) => {
            setMethod(m);
            setLastAutoMethod(m);
          }}
          bins={bins}
          onBinsChange={setBins}
          valueMin={valueMin}
          valueMax={valueMax}
          onWindowChange={(mn, mx) => {
            setValueMin(mn);
            setValueMax(mx);
          }}
          excludeZero={excludeZero}
          onExcludeZeroChange={setExcludeZero}
          ignoreTransparent={ignoreTransparent}
          onIgnoreTransparentChange={setIgnoreTransparent}
          hasAlpha={meta?.has_alpha ?? false}
          maxPossible={meta?.max_possible ?? null}
          hist={hist}
          disabled={busy}
        />

        <IntensityPalette
          levels={levels}
          stats={stats}
          preset={preset}
          reverse={reverse}
          onPresetChange={setPreset}
          onReverseChange={setReverse}
          onLevelColorChange={handleLevelColorChange}
          onIsolate={setIsolate}
          disabled={busy || levels.length === 0}
        />

        <WindowLevelPanel
          wl={wl}
          onChange={setWl}
          backdrop={backdrop}
          onBackdropChange={setBackdrop}
          hist={hist}
          overlayOpacity={overlayOpacity}
          onOverlayOpacityChange={setOverlayOpacity}
          disabled={busy}
        />

        <LevelTable
          levels={levels}
          stats={stats}
          hist={hist}
          loading={loading}
          exactLoading={exactLoading}
          onToggleVisible={handleToggleVisible}
          onIsolate={setIsolate}
          onRequestExact={handleRequestExact}
          onExportCsv={handleExportCsv}
          onCopyTsv={handleCopyTsv}
        />

        <IntensityHistogram
          hist={hist}
          levels={levels}
          mode={histMode}
          onModeChange={setHistMode}
          rgbHists={rgbHists}
          rgbLoading={rgbLoading}
          canShowRgb={(meta?.channels ?? 0) >= 3}
          onBoundaryChange={handleBoundaryChange}
        />
      </aside>
    </div>
  );
}
