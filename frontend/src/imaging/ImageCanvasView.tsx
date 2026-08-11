import { useCallback, useEffect, useRef, useState } from "react";
import { Stage, Layer, Image as KonvaImage, Rect, Transformer } from "react-konva";
import Konva from "konva";
import { useFitTransform } from "./useFitTransform";
import type { ROIRect } from "./types";

interface ImageCanvasViewProps {
  /** Original image, shown when no level map exists yet. */
  baseImage: HTMLImageElement | null;
  /** Composited level map (level colours over the original at some opacity). */
  levelCanvas: HTMLCanvasElement | null;
  /** Increments when levelCanvas pixels change in place. */
  canvasVersion: number;
  imageWidth: number;
  imageHeight: number;
  roiEnabled: boolean;
  roi: ROIRect | null;
  onROIChange: (roi: ROIRect | null) => void;
  onProbe?: (point: { x: number; y: number } | null) => void;
  onTransform?: (t: { zoom: number; isFit: boolean }) => void;
  /** Registers zoom controls so a parent toolbar can drive them. */
  onControls?: (c: {
    zoomIn: () => void;
    zoomOut: () => void;
    fit: () => void;
  }) => void;
}

const MIN_ROI_PX = 4;

export default function ImageCanvasView({
  baseImage,
  levelCanvas,
  canvasVersion,
  imageWidth,
  imageHeight,
  roiEnabled,
  roi,
  onROIChange,
  onProbe,
  onTransform,
  onControls,
}: ImageCanvasViewProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const imageNodeRef = useRef<Konva.Image | null>(null);
  const rectRef = useRef<Konva.Rect | null>(null);
  const trRef = useRef<Konva.Transformer | null>(null);
  const panRef = useRef<{ x: number; y: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  const {
    containerRef,
    containerSize,
    scale,
    offset,
    zoom,
    isFit,
    zoomAt,
    zoomIn,
    zoomOut,
    panBy,
    fit,
    toImageCoords,
  } = useFitTransform(imageWidth, imageHeight);

  const displaySource: CanvasImageSource | null = levelCanvas ?? baseImage;
  const hasContent = displaySource !== null && imageWidth > 0 && imageHeight > 0;

  useEffect(() => {
    onControls?.({ zoomIn, zoomOut, fit });
  }, [onControls, zoomIn, zoomOut, fit]);

  useEffect(() => {
    onTransform?.({ zoom, isFit });
  }, [onTransform, zoom, isFit]);

  // Konva caches the source element, so an in-place pixel change needs a
  // manual redraw (same pattern as analysis/ImageCanvas.tsx).
  useEffect(() => {
    imageNodeRef.current?.getLayer()?.batchDraw();
  }, [canvasVersion, levelCanvas]);

  // Attach the transformer whenever the ROI rect appears.
  const setRectRef = useCallback((node: Konva.Rect | null) => {
    rectRef.current = node;
    if (node && trRef.current) {
      trRef.current.nodes([node]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, []);

  useEffect(() => {
    if (trRef.current && rectRef.current && roi && roiEnabled) {
      trRef.current.nodes([rectRef.current]);
      trRef.current.getLayer()?.batchDraw();
    } else if (trRef.current && (!roi || !roiEnabled)) {
      trRef.current.nodes([]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [roi, roiEnabled]);

  // --- Zoom / pan --------------------------------------------------------

  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();
      const stage = stageRef.current;
      const pos = stage?.getPointerPosition();
      if (!pos) return;
      zoomAt(e.evt.deltaY < 0 ? 1.12 : 1 / 1.12, pos);
    },
    [zoomAt]
  );

  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      // Panning must not fight the ROI rect or its transformer handles.
      if (e.target !== stageRef.current && roiEnabled) return;
      const pos = stageRef.current?.getPointerPosition();
      if (!pos) return;
      panRef.current = { x: pos.x, y: pos.y };
      setIsPanning(true);
    },
    [roiEnabled]
  );

  const endPan = useCallback(() => {
    panRef.current = null;
    setIsPanning(false);
  }, []);

  const handleMouseMove = useCallback(() => {
    const stage = stageRef.current;
    const pos = stage?.getPointerPosition();
    if (!pos) return;

    if (panRef.current) {
      panBy(pos.x - panRef.current.x, pos.y - panRef.current.y);
      panRef.current = { x: pos.x, y: pos.y };
      return;
    }

    if (onProbe) {
      const p = toImageCoords(pos.x, pos.y);
      const inside =
        p.x >= 0 && p.y >= 0 && p.x < imageWidth && p.y < imageHeight;
      onProbe(inside ? p : null);
    }
  }, [panBy, onProbe, toImageCoords, imageWidth, imageHeight]);

  const handleMouseLeave = useCallback(() => {
    endPan();
    onProbe?.(null);
  }, [endPan, onProbe]);

  // --- ROI ---------------------------------------------------------------

  const handleDblClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!roiEnabled || !hasContent) {
        fit();
        return;
      }
      if (e.target !== stageRef.current) return;

      const pos = stageRef.current?.getPointerPosition();
      if (!pos) return;
      const center = toImageCoords(pos.x, pos.y);
      const size = Math.max(20, Math.round(Math.min(imageWidth, imageHeight) / 4));

      onROIChange({
        x: Math.round(center.x - size / 2),
        y: Math.round(center.y - size / 2),
        w: size,
        h: size,
      });
    },
    [roiEnabled, hasContent, fit, toImageCoords, imageWidth, imageHeight, onROIChange]
  );

  const commitRect = useCallback(() => {
    const node = rectRef.current;
    if (!node || !scale) return;

    const sx = node.scaleX();
    const sy = node.scaleY();
    const canvasW = Math.max(MIN_ROI_PX, node.width() * sx);
    const canvasH = Math.max(MIN_ROI_PX, node.height() * sy);
    node.scaleX(1);
    node.scaleY(1);

    onROIChange({
      x: (node.x() - offset.x) / scale,
      y: (node.y() - offset.y) / scale,
      w: canvasW / scale,
      h: canvasH / scale,
    });
  }, [scale, offset, onROIChange]);

  // ROI is stored in *image* coordinates and projected for display, so it
  // stays anchored to the same pixels through zoom, pan, and resize.
  const roiCanvas = roi
    ? {
        x: offset.x + roi.x * scale,
        y: offset.y + roi.y * scale,
        width: roi.w * scale,
        height: roi.h * scale,
      }
    : null;

  return (
    <div
      ref={containerRef}
      className="w-full h-full bg-slate-900 relative overflow-hidden"
      style={{ cursor: isPanning ? "grabbing" : roiEnabled ? "crosshair" : "grab" }}
    >
      {!hasContent && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center px-6">
            <svg
              className="mx-auto h-16 w-16 text-slate-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <p className="mt-3 text-sm text-slate-500">
              Upload an image to begin intensity analysis
            </p>
          </div>
        </div>
      )}

      {hasContent && (
        <Stage
          ref={stageRef}
          width={containerSize.width}
          height={containerSize.height}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseUp={endPan}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onDblClick={handleDblClick}
        >
          <Layer>
            <KonvaImage
              ref={(n) => {
                imageNodeRef.current = n;
              }}
              image={displaySource}
              x={offset.x}
              y={offset.y}
              width={imageWidth * scale}
              height={imageHeight * scale}
              listening={false}
            />

            {roiEnabled && roiCanvas && (
              <Rect
                ref={setRectRef}
                x={roiCanvas.x}
                y={roiCanvas.y}
                width={roiCanvas.width}
                height={roiCanvas.height}
                stroke="#22d3ee"
                strokeWidth={2}
                dash={[6, 3]}
                fill="rgba(34,211,238,0.08)"
                draggable
                onDragEnd={commitRect}
                onTransformEnd={commitRect}
              />
            )}

            {roiEnabled && (
              <Transformer
                ref={(n) => {
                  trRef.current = n;
                }}
                rotateEnabled={false}
                keepRatio={false}
                borderStroke="#22d3ee"
                anchorFill="#0e7490"
                anchorStroke="#22d3ee"
                anchorSize={8}
                boundBoxFunc={(oldBox, newBox) =>
                  newBox.width < MIN_ROI_PX || newBox.height < MIN_ROI_PX
                    ? oldBox
                    : newBox
                }
              />
            )}
          </Layer>
        </Stage>
      )}
    </div>
  );
}
