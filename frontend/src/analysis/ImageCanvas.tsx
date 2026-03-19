import { useRef, useState, useEffect, useCallback } from "react";
import { Stage, Layer, Image as KonvaImage, Rect, Ellipse, Transformer } from "react-konva";
import Konva from "konva";
import type { ROIType } from "./ROIControls";

interface ROIData {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

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
  rotation: number;
  holeRatio: number;
  onROIChange: (roi: ROIData) => void;
  /** Called with dose value at cursor position, or null when cursor leaves image */
  onCursorDose?: (dose: number | null, x: number, y: number) => void;
  /** Function to look up dose at image coordinates */
  getDoseAt?: (x: number, y: number) => number | null;
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
  onROIChange,
  onCursorDose,
  getDoseAt,
}: ImageCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const doseImageRef = useRef<Konva.Image | null>(null);
  const shapeRef = useRef<Konva.Rect | Konva.Ellipse | null>(null);
  const trRef = useRef<Konva.Transformer | null>(null);

  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 });
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [scale, setScale] = useState(1);
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 });

  // ROI state in canvas coordinates
  const [roi, setRoi] = useState<ROIData | null>(null);

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
        }
      }
    });
    observer.observe(container);

    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setContainerSize({ width: rect.width, height: rect.height });
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

  // Calculate scale and offset for image fitting
  useEffect(() => {
    if (displayWidth === 0 || displayHeight === 0) return;
    const scaleX = containerSize.width / displayWidth;
    const scaleY = containerSize.height / displayHeight;
    const s = Math.min(scaleX, scaleY);
    setScale(s);

    const offsetX = (containerSize.width - displayWidth * s) / 2;
    const offsetY = (containerSize.height - displayHeight * s) / 2;
    setImageOffset({ x: offsetX, y: offsetY });
  }, [displayWidth, displayHeight, containerSize]);

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
    (canvasRoi: ROIData) => {
      if (!scale || scale === 0) return;
      onROIChange({
        x: (canvasRoi.x - imageOffset.x) / scale,
        y: (canvasRoi.y - imageOffset.y) / scale,
        w: canvasRoi.w / scale,
        h: canvasRoi.h / scale,
        rotation: canvasRoi.rotation,
      });
    },
    [scale, imageOffset, onROIChange]
  );

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

      // If clicking on a shape (not the stage background), ignore
      const target = e.target;
      if (target !== stageRef.current) return;

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
        rotation: roiType === "Rectangle" ? rotation : 0,
      };

      setRoi(newRoi);
      emitROIChange(newRoi);
    },
    [displaySource, roiType, rotation, emitROIChange]
  );

  // Handle shape transform end
  const handleTransformEnd = useCallback(() => {
    const node = shapeRef.current;
    if (!node) return;

    if (roiType === "Rectangle") {
      const sx = node.scaleX();
      const sy = node.scaleY();
      const newRoi: ROIData = {
        x: node.x(),
        y: node.y(),
        w: Math.max(5, node.width() * sx),
        h: Math.max(5, node.height() * sy),
        rotation: node.rotation(),
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
        rotation: node.rotation(),
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
      const newRoi: ROIData = {
        x: node.x(),
        y: node.y(),
        w: roi?.w ?? 100,
        h: roi?.h ?? 100,
        rotation: node.rotation(),
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

          {roi && roiType === "Rectangle" && (
            <>
              <Rect
                ref={setShapeRef as (node: Konva.Rect | null) => void}
                x={roi.x}
                y={roi.y}
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
            </>
          )}
        </Layer>
      </Stage>
    </div>
  );
}
