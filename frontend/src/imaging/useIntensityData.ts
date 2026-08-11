/**
 * Fetches the intensity histogram and bin-code plane, and paints the level map.
 *
 * Two effects, deliberately separate:
 *   A. network -- runs when the *analysis* changes (session, source, bins,
 *      window, ROI). Fetches the histogram, then the plane.
 *   B. paint   -- runs when only the *presentation* changes (level bounds,
 *      colours, visibility, isolate, opacity). Never touches the network.
 *
 * Modeled on `analysis/useDoseMap.ts`, including the `canvasVersion` counter
 * that tells Konva to redraw a canvas whose pixels changed in place.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import client from "../api/client";
import { applyLevelLUT, buildLevelLUT, compositeLevelMap } from "./levelColors";
import { buildPrefix, type Prefix } from "./intensityStats";
import type { AnalyzeResponse, IntensitySource, Level, ROIRect } from "./types";

/** Upper bound on repaint latency when animation frames are not running. */
const PAINT_FALLBACK_MS = 50;

export interface UseIntensityDataOptions {
  sessionId: string | null;
  source: IntensitySource;
  bins: number;
  valueMin: number | null;
  valueMax: number | null;
  excludeZero: boolean;
  ignoreTransparent: boolean;
  roi: ROIRect | null;
  maxDim?: number;
  /** Gate the initial fetch while the tab is hidden. */
  visible?: boolean;
  /** Presentation inputs -- these repaint without refetching. */
  levels: Level[];
  isolate: number | null;
  overlayOpacity: number;
  baseImage: HTMLImageElement | null;
}

interface PlaneData {
  codes: Uint16Array;
  width: number;
  height: number;
  bins: number;
  downsample: number;
}

export function useIntensityData({
  sessionId,
  source,
  bins,
  valueMin,
  valueMax,
  excludeZero,
  ignoreTransparent,
  roi,
  maxDim = 2048,
  visible = true,
  levels,
  isolate,
  overlayOpacity,
  baseImage,
}: UseIntensityDataOptions) {
  const [hist, setHist] = useState<AnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canvasVersion, setCanvasVersion] = useState(0);

  const planeRef = useRef<PlaneData | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scratchRef = useRef<HTMLCanvasElement | null>(null);
  const pendingRef = useRef<{ raf: number | null; timer: number | null }>({
    raf: null,
    timer: null,
  });
  const requestSeq = useRef(0);

  const prefix: Prefix | null = useMemo(
    () => (hist ? buildPrefix(hist) : null),
    [hist]
  );

  const roiKey = roi ? `${roi.x},${roi.y},${roi.w},${roi.h}` : "";

  // --- Effect A: network -----------------------------------------------
  const fetchAll = useCallback(async () => {
    if (!sessionId) {
      setHist(null);
      planeRef.current = null;
      return;
    }

    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);

    try {
      const body = {
        source,
        bins,
        value_min: valueMin,
        value_max: valueMax,
        exclude_zero: excludeZero,
        ignore_transparent: ignoreTransparent,
        roi: roi
          ? { roi_type: "Rectangle", x: roi.x, y: roi.y, w: roi.w, h: roi.h }
          : null,
      };

      const analyzeRes = await client.post<AnalyzeResponse>(
        `/imaging/${sessionId}/analyze`,
        body
      );
      if (seq !== requestSeq.current) return; // superseded
      const analysis = analyzeRes.data;

      // Derive the plane query from the *response*, never from UI state:
      // identical binning is what keeps the painted map and the table in sync.
      const params = new URLSearchParams({
        source: analysis.source,
        bins: String(analysis.bins),
        value_min: String(analysis.value_min),
        value_max: String(analysis.value_max),
        exclude_zero: String(excludeZero),
        ignore_transparent: String(ignoreTransparent),
        max_dim: String(maxDim),
      });

      const planeRes = await client.get(
        `/imaging/${sessionId}/plane?${params.toString()}`,
        { responseType: "arraybuffer" }
      );
      if (seq !== requestSeq.current) return;

      const h = planeRes.headers;
      planeRef.current = {
        codes: new Uint16Array(planeRes.data as ArrayBuffer),
        width: parseInt(h["x-width"], 10),
        height: parseInt(h["x-height"], 10),
        bins: parseInt(h["x-int-bins"], 10),
        downsample: parseInt(h["x-int-downsample"], 10) || 1,
      };
      setHist(analysis);
    } catch (err: any) {
      if (seq !== requestSeq.current) return;
      const status = err.response?.status;
      setError(
        status === 404
          ? "Session expired — please re-upload the image."
          : err.response?.data?.detail || "Failed to analyse image"
      );
      setHist(null);
      planeRef.current = null;
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [
    sessionId, source, bins, valueMin, valueMax,
    excludeZero, ignoreTransparent, roiKey, maxDim,
  ]);

  useEffect(() => {
    if (!visible || !sessionId) return;
    fetchAll();
  }, [visible, sessionId, fetchAll]);

  // --- Effect B: paint (no network) -------------------------------------
  const paint = useCallback(() => {
    const plane = planeRef.current;
    if (!plane || levels.length === 0) return;

    let canvas = canvasRef.current;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvasRef.current = canvas;
    }
    let scratch = scratchRef.current;
    if (!scratch) {
      scratch = document.createElement("canvas");
      scratchRef.current = scratch;
    }

    const lut = buildLevelLUT(levels, plane.bins, { isolate });
    const imageData = applyLevelLUT(plane.codes, plane.width, plane.height, lut);
    compositeLevelMap(canvas, scratch, imageData, baseImage, overlayOpacity);

    setCanvasVersion((v) => v + 1);
  }, [levels, isolate, overlayOpacity, baseImage]);

  // Always call the newest paint from the pending callback, so coalescing
  // several changes still renders the latest state.
  const paintRef = useRef(paint);
  useEffect(() => {
    paintRef.current = paint;
  }, [paint]);

  /**
   * Coalesce repaints: `<input type="color">` and the opacity slider fire
   * continuously while dragging, and a multi-megapixel repaint per event
   * would stutter.
   *
   * An animation frame is the right cadence when the page is compositing,
   * but rAF never fires in a background or non-compositing tab -- relying on
   * it alone means the image silently never paints. So a short timer races
   * the frame and whichever arrives first wins.
   */
  const schedulePaint = useCallback(() => {
    const s = pendingRef.current;
    if (s.raf !== null || s.timer !== null) return; // already queued

    const run = () => {
      if (s.raf !== null) cancelAnimationFrame(s.raf);
      if (s.timer !== null) clearTimeout(s.timer);
      s.raf = null;
      s.timer = null;
      paintRef.current();
    };

    s.raf = requestAnimationFrame(run);
    s.timer = window.setTimeout(run, PAINT_FALLBACK_MS);
  }, []);

  useEffect(() => {
    if (!planeRef.current) return;
    schedulePaint();
  }, [paint, hist, schedulePaint]);

  // Cancel only on unmount -- cancelling on every dependency change would
  // kill the pending repaint before it ever ran.
  useEffect(
    () => () => {
      const s = pendingRef.current;
      if (s.raf !== null) cancelAnimationFrame(s.raf);
      if (s.timer !== null) clearTimeout(s.timer);
      s.raf = null;
      s.timer = null;
    },
    []
  );

  // --- Probe -------------------------------------------------------------

  /** Bin code at an image-space coordinate, or null outside / no-data. */
  const getCodeAt = useCallback((x: number, y: number): number | null => {
    const plane = planeRef.current;
    if (!plane) return null;
    const ix = Math.floor(x / plane.downsample);
    const iy = Math.floor(y / plane.downsample);
    if (ix < 0 || ix >= plane.width || iy < 0 || iy >= plane.height) return null;
    const code = plane.codes[iy * plane.width + ix];
    return code >= plane.bins ? null : code;
  }, []);

  /**
   * Approximate value at an image-space coordinate (bin centre).
   * The plane carries bin codes, so this is quantised by design.
   */
  const getValueAt = useCallback(
    (x: number, y: number): number | null => {
      const code = getCodeAt(x, y);
      if (code === null || !hist) return null;
      return hist.value_min + (code + 0.5) * hist.bin_width;
    },
    [getCodeAt, hist]
  );

  return {
    hist,
    prefix,
    canvas: canvasRef.current,
    canvasVersion,
    planeWidth: planeRef.current?.width ?? 0,
    planeHeight: planeRef.current?.height ?? 0,
    downsample: planeRef.current?.downsample ?? 1,
    loading,
    error,
    getCodeAt,
    getValueAt,
    refetch: fetchAll,
  };
}
