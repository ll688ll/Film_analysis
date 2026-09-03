/**
 * Container sizing, fit-to-view scaling, and zoom/pan for an image canvas.
 *
 * Grown out of the sizing logic in `analysis/ImageCanvas.tsx`, with a zoom
 * term added. Both canvases now share it, so they zoom identically. The film
 * canvas keeps its ROI in canvas coordinates and re-maps it whenever `scale`
 * or `offset` changes, which is what lets zoom and pan reach it at all.
 *
 * Scale and offset are applied to the image *node*, not to the Stage, so
 * every coordinate conversion stays the same two-line formula regardless of
 * zoom.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 40;

interface View {
  zoom: number;
  panX: number;
  panY: number;
}

const IDENTITY: View = { zoom: 1, panX: 0, panY: 0 };

export interface Point {
  x: number;
  y: number;
}

export function useFitTransform(contentWidth: number, contentHeight: number) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 });
  // False until the container reports a real size: a page mounts hidden (0x0)
  // when the app opens on another tab, and anything placed against the
  // placeholder size would land in the wrong spot.
  const [measured, setMeasured] = useState(false);
  const [view, setView] = useState<View>(IDENTITY);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        // ProtectedTabs hides inactive pages with a `hidden` class, so the
        // container reports 0x0 while the tab is in the background.
        if (width > 0 && height > 0) {
          setContainerSize({ width, height });
          setMeasured(true);
        }
      }
    });
    observer.observe(container);

    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setContainerSize({ width: rect.width, height: rect.height });
      setMeasured(true);
    }

    return () => observer.disconnect();
  }, []);

  const fitScale = useMemo(() => {
    if (!contentWidth || !contentHeight) return 1;
    return Math.min(
      containerSize.width / contentWidth,
      containerSize.height / contentHeight
    );
  }, [contentWidth, contentHeight, containerSize]);

  const scale = fitScale * view.zoom;

  const offset = useMemo(
    () => ({
      x: (containerSize.width - contentWidth * scale) / 2 + view.panX,
      y: (containerSize.height - contentHeight * scale) / 2 + view.panY,
    }),
    [containerSize, contentWidth, contentHeight, scale, view.panX, view.panY]
  );

  /** Zoom by *factor*, keeping the image point under *cursor* stationary. */
  const zoomAt = useCallback(
    (factor: number, cursor: Point) => {
      setView((v) => {
        const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
        if (nextZoom === v.zoom) return v;

        const s0 = fitScale * v.zoom;
        const s1 = fitScale * nextZoom;
        if (s0 <= 0) return { zoom: nextZoom, panX: 0, panY: 0 };

        const c0x = (containerSize.width - contentWidth * s0) / 2 + v.panX;
        const c0y = (containerSize.height - contentHeight * s0) / 2 + v.panY;
        const imgX = (cursor.x - c0x) / s0;
        const imgY = (cursor.y - c0y) / s0;

        return {
          zoom: nextZoom,
          panX: cursor.x - imgX * s1 - (containerSize.width - contentWidth * s1) / 2,
          panY: cursor.y - imgY * s1 - (containerSize.height - contentHeight * s1) / 2,
        };
      });
    },
    [fitScale, containerSize, contentWidth, contentHeight]
  );

  const panBy = useCallback((dx: number, dy: number) => {
    setView((v) => ({ ...v, panX: v.panX + dx, panY: v.panY + dy }));
  }, []);

  const fit = useCallback(() => setView(IDENTITY), []);

  const zoomIn = useCallback(() => {
    zoomAt(1.25, { x: containerSize.width / 2, y: containerSize.height / 2 });
  }, [zoomAt, containerSize]);

  const zoomOut = useCallback(() => {
    zoomAt(0.8, { x: containerSize.width / 2, y: containerSize.height / 2 });
  }, [zoomAt, containerSize]);

  const toImageCoords = useCallback(
    (canvasX: number, canvasY: number): Point => ({
      x: scale ? (canvasX - offset.x) / scale : 0,
      y: scale ? (canvasY - offset.y) / scale : 0,
    }),
    [scale, offset]
  );

  const toCanvasCoords = useCallback(
    (imageX: number, imageY: number): Point => ({
      x: offset.x + imageX * scale,
      y: offset.y + imageY * scale,
    }),
    [scale, offset]
  );

  return {
    containerRef,
    containerSize,
    measured,
    fitScale,
    scale,
    offset,
    zoom: view.zoom,
    isFit: view.zoom === 1 && view.panX === 0 && view.panY === 0,
    zoomAt,
    zoomIn,
    zoomOut,
    panBy,
    fit,
    toImageCoords,
    toCanvasCoords,
  };
}
