import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useFittedBox, type Size } from "./hooks/useFittedBox";
import { useWheelZoom } from "./hooks/useWheelZoom";
import { drawStrokes, useRenderEditStore, type RenderMaskStroke } from "./hooks/useRenderEditStore";

const SELECTION_COLOUR = "#2F6FED";
/** Clicking this close (in screen pixels) to a polygon's first point closes it. */
const CLOSE_DISTANCE = 10;

type Draft =
  | { kind: "brush" | "eraser"; points: number[] }
  | { kind: "rectangle"; x0: number; y0: number; x1: number; y1: number }
  | null;

interface RenderEditSurfaceProps {
  imageUrl: string;
  /** Leaves edit mode — called on Escape when there's nothing left to cancel. */
  onExit: () => void;
  /** Click-to-select: the clicked point, in image pixels. */
  onMagicSelect: (point: { x: number; y: number }) => void;
  /** True while an automatic selection is running, so clicks are ignored. */
  isSelecting?: boolean;
}

/** The render shown full-size with a paintable selection layer on top (render edit mode). */
export function RenderEditSurface({ imageUrl, onExit, onMagicSelect, isSelecting = false }: RenderEditSurfaceProps) {
  const tool = useRenderEditStore((state) => state.tool);
  const brushSize = useRenderEditStore((state) => state.brushSize);
  const strokes = useRenderEditStore((state) => state.strokes);
  const addStroke = useRenderEditStore((state) => state.addStroke);
  const undo = useRenderEditStore((state) => state.undo);
  const setTool = useRenderEditStore((state) => state.setTool);

  const areaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLCanvasElement | null>(null);
  const [natural, setNatural] = useState<Size | null>(null);
  const box = useFittedBox(areaRef, natural);
  const [draft, setDraft] = useState<Draft>(null);
  const [polygon, setPolygon] = useState<number[]>([]);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const { zoom, transformOrigin, targetRef, onWheel, resetZoom, isZoomed } = useWheelZoom(imageUrl);

  useEffect(() => {
    setNatural(null);
    setDraft(null);
    setPolygon([]);
  }, [imageUrl]);

  /** Image pixels per on-screen pixel, at the current zoom. */
  const scale = box && natural ? natural.width / (box.width * zoom) : 1;

  const toImage = (event: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * scale, y: (event.clientY - rect.top) * scale };
  };

  const closePolygon = useCallback(() => {
    if (polygon.length >= 6) addStroke({ kind: "polygon", points: polygon });
    setPolygon([]);
  }, [polygon, addStroke]);

  // Redraw the tinted selection whenever anything changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !box || !natural) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(box.width * zoom * ratio);
    canvas.height = Math.round(box.height * zoom * ratio);
    const context = canvas.getContext("2d");
    if (!context) return;

    const layer = (layerRef.current ??= document.createElement("canvas"));
    layer.width = canvas.width;
    layer.height = canvas.height;
    const layerContext = layer.getContext("2d")!;
    const toScreen = ratio / scale;
    layerContext.setTransform(toScreen, 0, 0, toScreen, 0, 0);

    const live: RenderMaskStroke[] = [...strokes];
    if (draft?.kind === "brush" || draft?.kind === "eraser") {
      live.push({ kind: draft.kind, size: brushSize * scale, points: draft.points });
    } else if (draft?.kind === "rectangle") {
      live.push({
        kind: "rectangle",
        x: Math.min(draft.x0, draft.x1),
        y: Math.min(draft.y0, draft.y1),
        width: Math.abs(draft.x1 - draft.x0),
        height: Math.abs(draft.y1 - draft.y0),
      });
    }
    drawStrokes(layerContext, live, SELECTION_COLOUR, null);

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.globalAlpha = 0.42;
    context.drawImage(layer, 0, 0);
    context.globalAlpha = 1;

    context.setTransform(toScreen, 0, 0, toScreen, 0, 0);
    context.lineWidth = 1.5 * scale;
    context.strokeStyle = SELECTION_COLOUR;
    context.fillStyle = "#fff";

    if (polygon.length > 0) {
      context.setLineDash([6 * scale, 4 * scale]);
      context.beginPath();
      context.moveTo(polygon[0]!, polygon[1]!);
      for (let index = 2; index < polygon.length; index += 2) context.lineTo(polygon[index]!, polygon[index + 1]!);
      if (pointer) context.lineTo(pointer.x, pointer.y);
      context.stroke();
      context.setLineDash([]);
      for (let index = 0; index < polygon.length; index += 2) {
        context.beginPath();
        context.arc(polygon[index]!, polygon[index + 1]!, (index === 0 ? 5 : 3.5) * scale, 0, Math.PI * 2);
        context.fill();
        context.stroke();
      }
    }

    if (pointer && tool === "magic") {
      context.beginPath();
      context.arc(pointer.x, pointer.y, 7 * scale, 0, Math.PI * 2);
      context.strokeStyle = SELECTION_COLOUR;
      context.lineWidth = 1.5 * scale;
      context.stroke();
    } else if (pointer && (tool === "brush" || tool === "eraser")) {
      context.beginPath();
      context.arc(pointer.x, pointer.y, (brushSize * scale) / 2, 0, Math.PI * 2);
      context.strokeStyle = tool === "eraser" ? "#e5484d" : SELECTION_COLOUR;
      context.stroke();
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
  }, [box, natural, zoom, scale, strokes, draft, polygon, pointer, tool, brushSize]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (polygon.length > 0) setPolygon((points) => points.slice(0, -2));
        else undo();
      } else if (event.key === "Escape") {
        if (polygon.length > 0 || draft) {
          setPolygon([]);
          setDraft(null);
        } else if (isZoomed) {
          resetZoom();
        } else {
          onExit();
        }
      } else if (event.key === "Enter" && polygon.length > 0) {
        closePolygon();
      } else if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        const shortcut = ({ b: "brush", e: "eraser", r: "rectangle", p: "polygon", a: "magic" } as const)[event.key.toLowerCase() as "b"];
        if (shortcut) setTool(shortcut);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [polygon, draft, undo, onExit, closePolygon, setTool, isZoomed, resetZoom]);

  // Switching tools abandons a half-drawn polygon.
  useEffect(() => setPolygon([]), [tool]);

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 || !box) return;
    const point = toImage(event);
    if (tool === "magic") {
      if (!isSelecting) onMagicSelect(point);
      return;
    }
    if (tool === "polygon") {
      if (polygon.length >= 6) {
        const distance = Math.hypot(point.x - polygon[0]!, point.y - polygon[1]!) / scale;
        if (distance <= CLOSE_DISTANCE) {
          closePolygon();
          return;
        }
      }
      setPolygon((points) => [...points, point.x, point.y]);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "rectangle") setDraft({ kind: "rectangle", x0: point.x, y0: point.y, x1: point.x, y1: point.y });
    else setDraft({ kind: tool, points: [point.x, point.y] });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!box) return;
    const point = toImage(event);
    setPointer(point);
    setDraft((current) => {
      if (!current) return current;
      if (current.kind === "rectangle") return { ...current, x1: point.x, y1: point.y };
      return { ...current, points: [...current.points, point.x, point.y] };
    });
  };

  const onPointerUp = () => {
    if (!draft) return;
    if (draft.kind === "rectangle") {
      const width = Math.abs(draft.x1 - draft.x0);
      const height = Math.abs(draft.y1 - draft.y0);
      // Ignore accidental clicks; a real rectangle is a few screen pixels across.
      if (width / scale > 3 && height / scale > 3) {
        addStroke({ kind: "rectangle", x: Math.min(draft.x0, draft.x1), y: Math.min(draft.y0, draft.y1), width, height });
      }
    } else {
      addStroke({ kind: draft.kind, size: brushSize * scale, points: draft.points });
    }
    setDraft(null);
  };

  return (
    <div ref={areaRef} className="render-preview-compare-area is-zoomable" onWheel={onWheel}>
      <img src={imageUrl} alt="" hidden onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
      {box ? (
        <div
          ref={targetRef}
          className="render-edit-surface"
          style={{ ...box, transform: `scale(${zoom})`, transformOrigin }}
        >
          <img src={imageUrl} alt="Render being edited" draggable={false} />
          <canvas
            ref={canvasRef}
            className={`is-${tool}${isSelecting ? " is-busy" : ""}`}
            style={box}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setDraft(null)}
            onPointerLeave={() => setPointer(null)}
            onDoubleClick={() => tool === "polygon" && closePolygon()}
          />
        </div>
      ) : (
        <span className="render-preview-spinner" aria-label="Loading image" />
      )}
      {isZoomed && (
        <button type="button" className="render-zoom-badge" onClick={resetZoom}>
          {Math.round(zoom * 100)}% · Reset
        </button>
      )}
    </div>
  );
}
