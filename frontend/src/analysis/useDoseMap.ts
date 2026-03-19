/**
 * Custom hook to fetch binary dose data from the backend
 * and produce a colormapped HTMLCanvasElement + Float32Array for cursor readout.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import client from "../api/client";
import { applyColormap, type ColormapName } from "./colormaps";

export interface DoseMapData {
  /** Colormapped canvas element (can be used as Konva Image source) */
  canvas: HTMLCanvasElement;
  /** Raw dose values for cursor readout */
  doseArray: Float32Array;
  /** Dose map width in pixels */
  width: number;
  /** Dose map height in pixels */
  height: number;
  /** Actual min dose value */
  doseMin: number;
  /** Actual max dose value */
  doseMax: number;
  /** Colormap display min */
  cmapMin: number;
  /** Colormap display max */
  cmapMax: number;
}

interface UseDoseMapOptions {
  sessionId: string | null;
  isCalibrated: boolean;
  /** Increment to force re-fetch (e.g. when re-applying calibration with different profile) */
  calibrationVersion?: number;
  colormap?: ColormapName;
  /** Override colormap min (from UI slider). If undefined, uses server value. */
  cmapMin?: number;
  /** Override colormap max (from UI slider). If undefined, uses server value. */
  cmapMax?: number;
}

export function useDoseMap({
  sessionId,
  isCalibrated,
  calibrationVersion = 0,
  colormap = "jet",
  cmapMin: cmapMinOverride,
  cmapMax: cmapMaxOverride,
}: UseDoseMapOptions) {
  const [doseMapData, setDoseMapData] = useState<DoseMapData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Persist a single offscreen canvas to avoid creating new objects on every re-render
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Version counter — increments on every repaint so consumers can detect changes
  const [canvasVersion, setCanvasVersion] = useState(0);

  // Track the raw data so colormap/range can be re-applied without re-fetch
  const rawDataRef = useRef<{
    doseArray: Float32Array;
    width: number;
    height: number;
    doseMin: number;
    doseMax: number;
    serverCmapMin: number;
    serverCmapMax: number;
  } | null>(null);

  // Effective colormap bounds
  const effectiveCmapMin = cmapMinOverride ?? rawDataRef.current?.serverCmapMin ?? 0;
  const effectiveCmapMax = cmapMaxOverride ?? rawDataRef.current?.serverCmapMax ?? 10;

  // Repaint the offscreen canvas with current colormap + range.
  // Returns the same canvas element (stable reference).
  const repaintCanvas = useCallback(
    (raw: NonNullable<typeof rawDataRef.current>, cMin: number, cMax: number, cmap: ColormapName) => {
      let canvas = canvasRef.current;
      if (!canvas || canvas.width !== raw.width || canvas.height !== raw.height) {
        canvas = document.createElement("canvas");
        canvas.width = raw.width;
        canvas.height = raw.height;
        canvasRef.current = canvas;
      }

      const imageData = applyColormap(raw.doseArray, raw.width, raw.height, cMin, cMax, cmap);
      const ctx = canvas.getContext("2d")!;
      ctx.putImageData(imageData, 0, 0);

      // Bump version so Konva knows to re-draw the image node
      setCanvasVersion((v) => v + 1);

      return canvas;
    },
    []
  );

  // Fetch dose data when calibration happens
  const fetchDoseData = useCallback(async () => {
    if (!sessionId || !isCalibrated) return;

    setLoading(true);
    setError(null);

    try {
      const res = await client.get(`/analysis/${sessionId}/dose-data`, {
        responseType: "arraybuffer",
      });

      const buffer: ArrayBuffer = res.data;
      const headers = res.headers;

      const width = parseInt(headers["x-width"], 10);
      const height = parseInt(headers["x-height"], 10);
      const doseMin = parseFloat(headers["x-dose-min"]);
      const doseMax = parseFloat(headers["x-dose-max"]);
      const serverCmapMin = parseFloat(headers["x-cmap-min"]);
      const serverCmapMax = parseFloat(headers["x-cmap-max"]);

      const doseArray = new Float32Array(buffer);

      const raw = { doseArray, width, height, doseMin, doseMax, serverCmapMin, serverCmapMax };
      rawDataRef.current = raw;

      const cMin = cmapMinOverride ?? serverCmapMin;
      const cMax = cmapMaxOverride ?? serverCmapMax;
      const canvas = repaintCanvas(raw, cMin, cMax, colormap);

      setDoseMapData({
        canvas,
        doseArray,
        width,
        height,
        doseMin,
        doseMax,
        cmapMin: cMin,
        cmapMax: cMax,
      });
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to load dose data");
    } finally {
      setLoading(false);
    }
    // Re-fetch when session/calibration/version changes, not on colormap/range changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, isCalibrated, calibrationVersion]);

  // Trigger fetch when sessionId/calibration/version changes
  useEffect(() => {
    if (isCalibrated && sessionId) {
      fetchDoseData();
    } else {
      setDoseMapData(null);
      rawDataRef.current = null;
      canvasRef.current = null;
    }
  }, [sessionId, isCalibrated, calibrationVersion, fetchDoseData]);

  // Re-apply colormap when colormap name or range changes (no re-fetch)
  useEffect(() => {
    const raw = rawDataRef.current;
    if (!raw) return;

    const cMin = cmapMinOverride ?? raw.serverCmapMin;
    const cMax = cmapMaxOverride ?? raw.serverCmapMax;
    const canvas = repaintCanvas(raw, cMin, cMax, colormap);

    setDoseMapData((prev) =>
      prev
        ? { ...prev, canvas, cmapMin: cMin, cmapMax: cMax }
        : null
    );
  }, [colormap, cmapMinOverride, cmapMaxOverride, repaintCanvas]);

  /** Look up the dose value at a given pixel coordinate (image space). */
  const getDoseAt = useCallback(
    (x: number, y: number): number | null => {
      const raw = rawDataRef.current;
      if (!raw) return null;
      const ix = Math.round(x);
      const iy = Math.round(y);
      if (ix < 0 || ix >= raw.width || iy < 0 || iy >= raw.height) return null;
      return raw.doseArray[iy * raw.width + ix];
    },
    []
  );

  return {
    doseMapData,
    loading,
    error,
    getDoseAt,
    refetch: fetchDoseData,
    /** Increments on every canvas repaint — use to trigger Konva redraws */
    canvasVersion,
    /** Effective cmap min for display */
    effectiveCmapMin,
    /** Effective cmap max for display */
    effectiveCmapMax,
  };
}
