import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import {
  Stage,
  Layer,
  Image as KonvaImage,
  Rect,
  Ellipse,
  Circle,
  Line,
  Group,
  Shape,
  Transformer,
} from "react-konva";
import Konva from "konva";
import { profileHalfSpan } from "./profileMetrics";
import type { Isoline, ProfileOffset, ROIData, ROIType } from "./roiTypes";

export type RoiChangeReason = "place" | "edit";

interface ImageCanvasProps {
  imageUrl: string | null;
  /** Optional: colormapped dose map canvas (overrides imageUrl when provided) */
  doseMapCanvas: HTMLCanvasElement | null;
  /** Image dimensions for dose map (needed since canvas.width/height are used) */
  doseMapWidth?: number;
  doseMapHeight?: number;
  /** Increments when canvas pixels change — forces Konva to redraw */
  canvasVersion?: number;
  roiType: ROIType;
  /** Rotation of the rectangle ROI in degrees; rotating the handle reports back through onROIChange. */
  rotation: number;
  holeRatio: number;
  /** Rectangle corner removal: draw chamfered outline when enabled */
  cornerCutEnabled: boolean;
  cornerCutMm: number;
  dpi: number;
  /** `place` for a fresh double-click ROI, `edit` for a move, resize or rotation. */
  onROIChange: (roi: ROIData, reason: RoiChangeReason) => void;
  /** Called with dose value at cursor position, or null when cursor leaves image */
  onCursorDose?: (dose: number | null, x: number, y: number) => void;
  /** Function to look up dose at image coordinates */
  getDoseAt?: (x: number, y: number) => number | null;
  /** ROI in image coordinates to draw when restoring a saved analysis. */
  initialRoi?: ROIData | null;
  /** Bump to apply `initialRoi`; the ROI is otherwise owned by user interaction. */
  initialRoiVersion?: number;
  /** Isodose lines (image pixels) drawn over the map; null hides them. */
  isolines?: Isoline[] | null;
  /** Profile crosshair offsets from the ROI centre (image px); null hides it. */
  profileCrosshair?: ProfileOffset | null;
  onProfileOffsetChange?: (offset: ProfileOffset) => void;
}

/** Keep a rotation in [0, 360) so the slider and the Transformer agree. */
function normalizeDeg(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

export default function ImageCanvas({
  imageUrl,
  doseMapCanvas,
  doseMapWidth,
  doseMapHeight,
  canvasVersion,
  roiType,
  rotation,
  holeRatio,
  cornerCutEnabled,
  cornerCutMm,
  dpi,
  onROIChange,
  onCursorDose,
  getDoseAt,
  initialRoi = null,
  initialRoiVersion = 0,
  isolines = null,
  profileCrosshair = null,
  onProfileOffsetChange,
}: ImageCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const doseImageRef = useRef<Konva.Image | null>(null);
  const shapeRef = useRef<Konva.Rect | Konva.Ellipse | null>(null);
  const trRef = useRef<Konva.Transformer | null>(null);

  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 });
  // False until the container has reported a real size: the page mounts
  // hidden (0x0) when the app opens on another tab, and a ROI placed against
  // the placeholder size would land in the wrong spot.
  const [measured, setMeasured] = useState(false);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [scale, setScale] = useState(1);
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 });

  // ROI state in canvas coordinates. `x, y, w, h` is the unrotated box; the
  // rectangle is drawn about the box centre so that rotation matches the
  // backend mask, which also rotates about (x + w/2, y + h/2).
  const [roi, setRoi] = useState<ROIData | null>(null);
  const appliedRoiVersionRef = useRef(0);

  // Determine what to display: dose map canvas takes priority
  const displaySource = doseMapCanvas ?? image;
  const displayWidth = doseMapCanvas ? (doseMapWidth ?? doseMapCanvas.width) : (image?.width ?? 0);
  const displayHeight = doseMapCanvas ? (doseMapHeight ?? doseMapCanvas.height) : (image?.height ?? 0);

  // Observe container size
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
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

  // Load image when URL changes (only used when no dose map canvas)
  useEffect(() => {
    if (doseMapCanvas) return; // dose map canvas takes priority
    if (!imageUrl) {
      setImage(null);
      setRoi(null);
      return;
    }

    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.src = imageUrl;
    img.onload = () => {
      setImage(img);
      setRoi(null);
    };
  }, [imageUrl, doseMapCanvas]);

  // Calculate scale and offset for image fitting. The ROI lives in canvas
  // coordinates, so when the view re-fits (window or panel resized) it is
  // re-mapped onto the same film pixels instead of staying where it was.
  useEffect(() => {
    if (displayWidth === 0 || displayHeight === 0) return;
    const scaleX = containerSize.width / displayWidth;
    const scaleY = containerSize.height / displayHeight;
    const s = Math.min(scaleX, scaleY);
    const offsetX = (containerSize.width - displayWidth * s) / 2;
    const offsetY = (containerSize.height - displayHeight * s) / 2;

    const prevScale = scale;
    const prevOffset = imageOffset;
    if (s !== prevScale || offsetX !== prevOffset.x || offsetY !== prevOffset.y) {
      setRoi((prev) => {
        if (!prev || !prevScale) return prev;
        const ratio = s / prevScale;
        return {
          x: ((prev.x - prevOffset.x) / prevScale) * s + offsetX,
          y: ((prev.y - prevOffset.y) / prevScale) * s + offsetY,
          w: prev.w * ratio,
          h: prev.h * ratio,
          rotation: prev.rotation,
        };
      });
    }
    setScale(s);
    setImageOffset({ x: offsetX, y: offsetY });
    // scale/imageOffset are the values being replaced, not triggers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayWidth, displayHeight, containerSize]);

  // Draw a restored ROI once the display and its scale exist. Loading a preview
  // clears the ROI, so AnalysisPage bumps the version only after the dose map is
  // in place; the ref makes each version apply exactly once.
  useEffect(() => {
    if (!initialRoi || initialRoiVersion === appliedRoiVersionRef.current) return;
    if (!displaySource || !scale || !measured) return;

    appliedRoiVersionRef.current = initialRoiVersion;
    setRoi({
      x: initialRoi.x * scale + imageOffset.x,
      y: initialRoi.y * scale + imageOffset.y,
      w: initialRoi.w * scale,
      h: initialRoi.h * scale,
      rotation: normalizeDeg(initialRoi.rotation),
    });
  }, [initialRoi, initialRoiVersion, displaySource, scale, imageOffset, measured]);

  // When canvas pixels change (colormap/range), tell Konva to re-draw the image
  useEffect(() => {
    if (doseImageRef.current && doseMapCanvas) {
      // Invalidate Konva's internal image cache and redraw
      doseImageRef.current.getLayer()?.batchDraw();
    }
  }, [canvasVersion, doseMapCanvas]);

  // Attach transformer to shape (deferred to ensure refs are ready)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (trRef.current && shapeRef.current && roi) {
        trRef.current.nodes([shapeRef.current]);
        trRef.current.getLayer()?.batchDraw();
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [roi, roiType]);

  // Emit ROI change in image coordinates
  const emitROIChange = useCallback(
    (canvasRoi: ROIData, reason: RoiChangeReason = "edit") => {
      if (!scale || scale === 0) return;
      onROIChange(
        {
          x: (canvasRoi.x - imageOffset.x) / scale,
          y: (canvasRoi.y - imageOffset.y) / scale,
          w: canvasRoi.w / scale,
          h: canvasRoi.h / scale,
          rotation: canvasRoi.rotation,
        },
        reason
      );
    },
    [scale, imageOffset, onROIChange]
  );

  // The Rotation control rotates the current rectangle. The Transformer handle
  // reports its angle back through onROIChange, so only act when they differ.
  useEffect(() => {
    if (roiType !== "Rectangle" || !roi) return;
    const target = normalizeDeg(rotation);
    if (roi.rotation === target) return;
    const next = { ...roi, rotation: target };
    setRoi(next);
    emitROIChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotation]);

  // Handle mouse move for dose readout
  const handleMouseMove = useCallback(
    (_e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!getDoseAt || !onCursorDose) return;

      const stage = stageRef.current;
      if (!stage) return;
      const pos = stage.getPointerPosition();
      if (!pos) return;

      // Convert canvas coords to image coords
      const imgX = (pos.x - imageOffset.x) / scale;
      const imgY = (pos.y - imageOffset.y) / scale;

      const dose = getDoseAt(imgX, imgY);
      onCursorDose(dose, imgX, imgY);
    },
    [getDoseAt, onCursorDose, imageOffset, scale]
  );

  const handleMouseLeave = useCallback(() => {
    if (onCursorDose) onCursorDose(null, 0, 0);
  }, [onCursorDose]);

  // Create ROI on double-click
  const handleStageClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!displaySource) return;

      // Only the stage background or the film itself places a ROI; a
      // double-click on the existing ROI or its handles is left alone.
      const target = e.target;
      if (target !== stageRef.current && target !== doseImageRef.current) return;

      const stage = stageRef.current;
      if (!stage) return;
      const pos = stage.getPointerPosition();
      if (!pos) return;

      const defaultW = 100;
      const defaultH = 100;

      const newRoi: ROIData = {
        x: pos.x - defaultW / 2,
        y: pos.y - defaultH / 2,
        w: defaultW,
        h: defaultH,
        rotation: roiType === "Rectangle" ? normalizeDeg(rotation) : 0,
      };

      setRoi(newRoi);
      emitROIChange(newRoi, "place");
    },
    [displaySource, roiType, rotation, emitROIChange]
  );

  // Handle shape transform end
  const handleTransformEnd = useCallback(() => {
    const node = shapeRef.current;
    if (!node) return;

    if (roiType === "Rectangle") {
      // With the offset at the box centre, node.x()/y() is the visual centre
      // whatever the scale, so the box follows from the new size.
      const sx = node.scaleX();
      const sy = node.scaleY();
      const w = Math.max(5, node.width() * sx);
      const h = Math.max(5, node.height() * sy);
      const newRoi: ROIData = {
        x: node.x() - w / 2,
        y: node.y() - h / 2,
        w,
        h,
        rotation: normalizeDeg(node.rotation()),
      };
      node.scaleX(1);
      node.scaleY(1);
      setRoi(newRoi);
      emitROIChange(newRoi);
    } else {
      const sx = node.scaleX();
      const sy = node.scaleY();
      const ellipseNode = node as Konva.Ellipse;
      const rx = ellipseNode.radiusX() * sx;
      const ry = ellipseNode.radiusY() * sy;
      const newRoi: ROIData = {
        x: node.x() - rx,
        y: node.y() - ry,
        w: rx * 2,
        h: ry * 2,
        rotation: 0,
      };
      node.scaleX(1);
      node.scaleY(1);
      ellipseNode.radiusX(rx);
      ellipseNode.radiusY(ry);
      setRoi(newRoi);
      emitROIChange(newRoi);
    }
  }, [roiType, emitROIChange]);

  // Handle shape drag end
  const handleDragEnd = useCallback(() => {
    const node = shapeRef.current;
    if (!node) return;

    if (roiType === "Rectangle") {
      const w = roi?.w ?? 100;
      const h = roi?.h ?? 100;
      const newRoi: ROIData = {
        x: node.x() - w / 2,
        y: node.y() - h / 2,
        w,
        h,
        rotation: normalizeDeg(node.rotation()),
      };
      setRoi(newRoi);
      emitROIChange(newRoi);
    } else {
      const ellipseNode = node as Konva.Ellipse;
      const rx = ellipseNode.radiusX();
      const ry = ellipseNode.radiusY();
      const newRoi: ROIData = {
        x: node.x() - rx,
        y: node.y() - ry,
        w: rx * 2,
        h: ry * 2,
        rotation: 0,
      };
      setRoi(newRoi);
      emitROIChange(newRoi);
    }
  }, [roiType, roi, emitROIChange]);

  // Callback ref for shape - immediately attach transformer
  const setShapeRef = useCallback(
    (node: Konva.Rect | Konva.Ellipse | null) => {
      shapeRef.current = node;
      if (node && trRef.current) {
        trRef.current.nodes([node]);
        trRef.current.getLayer()?.batchDraw();
      }
    },
    []
  );

  // Isodose lines: image px -> canvas px, flattened for Konva
  const canvasIsolines = useMemo(() => {
    if (!isolines || !scale) return null;
    const out: number[][] = [];
    for (const iso of isolines) {
      for (const path of iso.paths) {
        const pts = new Array<number>(path.length);
        for (let i = 0; i < path.length; i += 2) {
          pts[i] = path[i] * scale + imageOffset.x;
          pts[i + 1] = path[i + 1] * scale + imageOffset.y;
        }
        out.push(pts);
      }
    }
    return out;
  }, [isolines, scale, imageOffset]);

  // One Konva node strokes every path at once; a node per path would be
  // thousands of shapes on a noisy film.
  const drawIsolines = useCallback(
    (ctx: Konva.Context, shape: Konva.Shape) => {
      if (!canvasIsolines) return;
      ctx.beginPath();
      for (const pts of canvasIsolines) {
        if (pts.length < 4) continue;
        ctx.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      }
      ctx.strokeShape(shape);
    },
    [canvasIsolines]
  );

  // Profile crosshair in canvas coordinates: the two sampled lines and the
  // point where they cross, all relative to the ROI centre along its axes.
  const crosshair = useMemo(() => {
    if (!profileCrosshair || !roi || !scale) return null;
    const t = (roi.rotation * Math.PI) / 180;
    const ux = Math.cos(t);
    const uy = Math.sin(t);
    const vx = -Math.sin(t);
    const vy = Math.cos(t);
    const cx = roi.x + roi.w / 2;
    const cy = roi.y + roi.h / 2;
    const u0 = profileCrosshair.u * scale;
    const v0 = profileCrosshair.v * scale;
    const imageRoi = { ...roi, w: roi.w / scale, h: roi.h / scale };
    const spanU = profileHalfSpan(imageRoi, "h") * scale;
    const spanV = profileHalfSpan(imageRoi, "v") * scale;
    return {
      ux, uy, vx, vy,
      halfU: roi.w / 2,
      halfV: roi.h / 2,
      u0, v0,
      centre: { x: cx + u0 * ux + v0 * vx, y: cy + u0 * uy + v0 * vy },
      hPoints: [
        cx - spanU * ux + v0 * vx, cy - spanU * uy + v0 * vy,
        cx + spanU * ux + v0 * vx, cy + spanU * uy + v0 * vy,
      ],
      vPoints: [
        cx + u0 * ux - spanV * vx, cy + u0 * uy - spanV * vy,
        cx + u0 * ux + spanV * vx, cy + u0 * uy + spanV * vy,
      ],
    };
  }, [profileCrosshair, roi, scale]);

  // Drags are pure translations of nodes that start at (0, 0), so a node's
  // position is the displacement; it is projected onto the allowed axis and
  // clamped to the ROI box, then folded back into the offsets in image px.
  const clampAlong = (d: number, current: number, half: number) =>
    Math.max(-half - current, Math.min(half - current, d));

  const boundHLine = useCallback(
    (pos: Konva.Vector2d): Konva.Vector2d => {
      if (!crosshair) return pos;
      const { vx, vy, v0, halfV } = crosshair;
      const d = clampAlong(pos.x * vx + pos.y * vy, v0, halfV);
      return { x: d * vx, y: d * vy };
    },
    [crosshair]
  );
  const boundVLine = useCallback(
    (pos: Konva.Vector2d): Konva.Vector2d => {
      if (!crosshair) return pos;
      const { ux, uy, u0, halfU } = crosshair;
      const d = clampAlong(pos.x * ux + pos.y * uy, u0, halfU);
      return { x: d * ux, y: d * uy };
    },
    [crosshair]
  );
  const boundCentre = useCallback(
    (pos: Konva.Vector2d): Konva.Vector2d => {
      if (!crosshair) return pos;
      const { ux, uy, vx, vy, u0, v0, halfU, halfV } = crosshair;
      // The circle's own position is its centre, so subtract it first
      const dx = pos.x - crosshair.centre.x;
      const dy = pos.y - crosshair.centre.y;
      const du = clampAlong(dx * ux + dy * uy, u0, halfU);
      const dv = clampAlong(dx * vx + dy * vy, v0, halfV);
      return {
        x: crosshair.centre.x + du * ux + dv * vx,
        y: crosshair.centre.y + du * uy + dv * vy,
      };
    },
    [crosshair]
  );

  const finishCrosshairDrag = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>, what: "h" | "v" | "centre") => {
      if (!crosshair || !profileCrosshair || !onProfileOffsetChange) return;
      const node = e.target;
      const { ux, uy, vx, vy } = crosshair;
      let dx = node.x();
      let dy = node.y();
      if (what === "centre") {
        dx -= crosshair.centre.x;
        dy -= crosshair.centre.y;
        node.position(crosshair.centre);
      } else {
        node.position({ x: 0, y: 0 });
      }
      const du = what === "h" ? 0 : (dx * ux + dy * uy) / scale;
      const dv = what === "v" ? 0 : (dx * vx + dy * vy) / scale;
      onProfileOffsetChange({ u: profileCrosshair.u + du, v: profileCrosshair.v + dv });
    },
    [crosshair, profileCrosshair, onProfileOffsetChange, scale]
  );

  const setCursor = useCallback((cursor: string) => {
    const container = stageRef.current?.container();
    if (container) container.style.cursor = cursor;
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full bg-slate-900 relative overflow-hidden"
    >
      {!displaySource && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
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
              Upload a film image to begin
            </p>
            <p className="mt-1 text-xs text-slate-600">
              Double-click on image to place ROI
            </p>
          </div>
        </div>
      )}

      <Stage
        ref={stageRef}
        width={containerSize.width}
        height={containerSize.height}
        onDblClick={handleStageClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <Layer>
          {displaySource && (
            <KonvaImage
              ref={(node: Konva.Image | null) => { doseImageRef.current = node; }}
              image={displaySource}
              x={imageOffset.x}
              y={imageOffset.y}
              width={displayWidth * scale}
              height={displayHeight * scale}
            />
          )}

          {/* Isodose overlay sits under the ROI so the handles stay on top */}
          {canvasIsolines && canvasIsolines.length > 0 && (
            <Group listening={false}>
              <Shape
                sceneFunc={drawIsolines}
                stroke="#0f172a"
                strokeWidth={3}
                opacity={0.6}
                lineJoin="round"
                lineCap="round"
                perfectDrawEnabled={false}
              />
              <Shape
                sceneFunc={drawIsolines}
                stroke="#ffffff"
                strokeWidth={1.25}
                lineJoin="round"
                lineCap="round"
                perfectDrawEnabled={false}
              />
            </Group>
          )}

          {roi && roiType === "Rectangle" && (
            <>
              <Rect
                ref={setShapeRef as (node: Konva.Rect | null) => void}
                x={roi.x + roi.w / 2}
                y={roi.y + roi.h / 2}
                offsetX={roi.w / 2}
                offsetY={roi.h / 2}
                width={roi.w}
                height={roi.h}
                rotation={roi.rotation}
                stroke="#22d3ee"
                strokeWidth={2}
                dash={[6, 3]}
                fill="rgba(34,211,238,0.08)"
                draggable
                onDragEnd={handleDragEnd}
                onTransformEnd={handleTransformEnd}
              />
              {cornerCutEnabled && cornerCutMm > 0 && (() => {
                // mm -> image px -> canvas px; same clamp as the backend
                const c = Math.min(
                  ((cornerCutMm * dpi) / 25.4) * scale,
                  roi.w / 2,
                  roi.h / 2
                );
                const pts = [
                  c, 0,
                  roi.w - c, 0,
                  roi.w, c,
                  roi.w, roi.h - c,
                  roi.w - c, roi.h,
                  c, roi.h,
                  0, roi.h - c,
                  0, c,
                ];
                return (
                  <Line
                    x={roi.x + roi.w / 2}
                    y={roi.y + roi.h / 2}
                    offsetX={roi.w / 2}
                    offsetY={roi.h / 2}
                    rotation={roi.rotation}
                    points={pts}
                    closed
                    stroke="#f97316"
                    strokeWidth={1.5}
                    dash={[4, 3]}
                    listening={false}
                  />
                );
              })()}
            </>
          )}

          {roi && (roiType === "Circle" || roiType === "Ring") && (
            <>
              <Ellipse
                ref={setShapeRef as (node: Konva.Ellipse | null) => void}
                x={roi.x + roi.w / 2}
                y={roi.y + roi.h / 2}
                radiusX={roi.w / 2}
                radiusY={roi.h / 2}
                stroke="#22d3ee"
                strokeWidth={2}
                dash={[6, 3]}
                fill="rgba(34,211,238,0.08)"
                draggable
                onDragEnd={handleDragEnd}
                onTransformEnd={handleTransformEnd}
              />
              {roiType === "Ring" && (
                <Ellipse
                  x={roi.x + roi.w / 2}
                  y={roi.y + roi.h / 2}
                  radiusX={(roi.w / 2) * (holeRatio / 100)}
                  radiusY={(roi.h / 2) * (holeRatio / 100)}
                  stroke="#f97316"
                  strokeWidth={1.5}
                  dash={[4, 3]}
                  fill="rgba(249,115,22,0.06)"
                  listening={false}
                />
              )}
            </>
          )}

          {/* Profile crosshair: above the ROI shape so it can be grabbed, below
              the Transformer so the resize handles keep priority */}
          {crosshair && (
            <Group>
              <Line
                points={crosshair.hPoints}
                stroke="#facc15"
                strokeWidth={1.5}
                dash={[8, 4]}
                hitStrokeWidth={16}
                draggable
                dragBoundFunc={boundHLine}
                onDragEnd={(e) => finishCrosshairDrag(e, "h")}
                onMouseEnter={() => setCursor("move")}
                onMouseLeave={() => setCursor("default")}
              />
              <Line
                points={crosshair.vPoints}
                stroke="#facc15"
                strokeWidth={1.5}
                dash={[8, 4]}
                hitStrokeWidth={16}
                draggable
                dragBoundFunc={boundVLine}
                onDragEnd={(e) => finishCrosshairDrag(e, "v")}
                onMouseEnter={() => setCursor("move")}
                onMouseLeave={() => setCursor("default")}
              />
              <Circle
                x={crosshair.centre.x}
                y={crosshair.centre.y}
                radius={6}
                fill="#facc15"
                stroke="#0f172a"
                strokeWidth={1.5}
                hitStrokeWidth={12}
                draggable
                dragBoundFunc={boundCentre}
                onDragEnd={(e) => finishCrosshairDrag(e, "centre")}
                onMouseEnter={() => setCursor("move")}
                onMouseLeave={() => setCursor("default")}
              />
            </Group>
          )}

          {roi && roiType === "Rectangle" && (
            <Transformer
              ref={(node: Konva.Transformer | null) => { trRef.current = node; }}
              rotateEnabled
              keepRatio={false}
              borderStroke="#22d3ee"
              borderStrokeWidth={1}
              anchorStroke="#22d3ee"
              anchorFill="#0e7490"
              anchorSize={8}
              anchorCornerRadius={2}
            />
          )}
          {roi && (roiType === "Circle" || roiType === "Ring") && (
            <Transformer
              ref={(node: Konva.Transformer | null) => { trRef.current = node; }}
              rotateEnabled={false}
              keepRatio={roiType === "Circle"}
              borderStroke="#22d3ee"
              borderStrokeWidth={1}
              anchorStroke="#22d3ee"
              anchorFill="#0e7490"
              anchorSize={8}
              anchorCornerRadius={2}
            />
          )}
        </Layer>
      </Stage>
    </div>
  );
}
