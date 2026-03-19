import { useEffect, useRef, useState, useCallback } from "react";
import { Stage, Layer, Image as KonvaImage, Rect, Transformer } from "react-konva";
import Konva from "konva";

interface WizardCanvasProps {
  imageUrl: string | null;
  onROIChange: (roi: { x: number; y: number; w: number; h: number }) => void;
}

export default function WizardCanvas({ imageUrl, onROIChange }: WizardCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rectRef = useRef<Konva.Rect>(null);
  const trRef = useRef<Konva.Transformer>(null);

  const [containerSize, setContainerSize] = useState({ width: 600, height: 400 });
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [scale, setScale] = useState(1);
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 });

  // ROI state in stage (scaled) coordinates
  const [roi, setRoi] = useState({ x: 50, y: 50, w: 80, h: 80 });

  // Observe container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setContainerSize({ width, height });
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Load image
  useEffect(() => {
    if (!imageUrl) {
      setImage(null);
      return;
    }
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setImage(img);
    img.src = imageUrl;
  }, [imageUrl]);

  // Compute scale whenever image or container changes
  useEffect(() => {
    if (!image) return;
    const scaleX = containerSize.width / image.width;
    const scaleY = containerSize.height / image.height;
    const s = Math.min(scaleX, scaleY, 1);
    setScale(s);

    const offsetX = (containerSize.width - image.width * s) / 2;
    const offsetY = (containerSize.height - image.height * s) / 2;
    setImageOffset({ x: offsetX, y: offsetY });
  }, [image, containerSize]);

  // Attach transformer
  useEffect(() => {
    if (trRef.current && rectRef.current) {
      trRef.current.nodes([rectRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [image]);

  // Propagate ROI change to parent in image coordinates
  const propagateROI = useCallback(
    (stageRoi: { x: number; y: number; w: number; h: number }) => {
      if (!image || scale === 0) return;
      onROIChange({
        x: Math.round((stageRoi.x - imageOffset.x) / scale),
        y: Math.round((stageRoi.y - imageOffset.y) / scale),
        w: Math.round(stageRoi.w / scale),
        h: Math.round(stageRoi.h / scale),
      });
    },
    [scale, imageOffset, image, onROIChange]
  );

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    const newRoi = { x: node.x(), y: node.y(), w: roi.w, h: roi.h };
    setRoi(newRoi);
    propagateROI(newRoi);
  };

  const handleTransformEnd = () => {
    const node = rectRef.current;
    if (!node) return;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    const newRoi = {
      x: node.x(),
      y: node.y(),
      w: Math.max(10, node.width() * scaleX),
      h: Math.max(10, node.height() * scaleY),
    };
    node.scaleX(1);
    node.scaleY(1);
    node.width(newRoi.w);
    node.height(newRoi.h);
    setRoi(newRoi);
    propagateROI(newRoi);
  };

  if (!imageUrl) {
    return (
      <div
        ref={containerRef}
        className="w-full h-full flex items-center justify-center bg-slate-50 border-2 border-dashed border-slate-300 rounded-lg"
      >
        <p className="text-sm text-slate-400">Upload a film image to begin</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full h-full bg-slate-900 rounded-lg overflow-hidden">
      <Stage width={containerSize.width} height={containerSize.height}>
        <Layer>
          {image && (
            <KonvaImage
              image={image}
              x={imageOffset.x}
              y={imageOffset.y}
              width={image.width * scale}
              height={image.height * scale}
            />
          )}
          {image && (
            <>
              <Rect
                ref={rectRef}
                x={roi.x}
                y={roi.y}
                width={roi.w}
                height={roi.h}
                stroke="#facc15"
                strokeWidth={2}
                dash={[6, 3]}
                draggable
                onDragEnd={handleDragEnd}
                onTransformEnd={handleTransformEnd}
              />
              <Transformer
                ref={trRef}
                rotateEnabled={false}
                keepRatio={false}
                boundBoxFunc={(_oldBox, newBox) => {
                  if (newBox.width < 10 || newBox.height < 10) return _oldBox;
                  return newBox;
                }}
              />
            </>
          )}
        </Layer>
      </Stage>
    </div>
  );
}
