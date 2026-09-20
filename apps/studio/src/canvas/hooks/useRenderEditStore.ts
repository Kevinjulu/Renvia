import { create } from "zustand";
import { useCanvasStore } from "./useCanvasStore";
import { useRenderJobsStore } from "./useRenderJobsStore";

export type RenderEditTool = "brush" | "eraser" | "rectangle" | "polygon" | "magic";

/**
 * One mark of a render-edit selection, in the render image's natural pixel coordinates so
 * it's independent of how large the viewer shows the image. Marks apply in order: brush,
 * rectangle and polygon add to the selection, eraser removes from it.
 */
export type RenderMaskStroke =
  | { kind: "brush" | "eraser"; size: number; points: number[] }
  | { kind: "rectangle"; x: number; y: number; width: number; height: number }
  | { kind: "polygon"; points: number[] }
  /** A mask returned by automatic selection, already at the image's natural size. */
  | { kind: "mask"; image: CanvasImageSource; width: number; height: number; tinted?: Map<string, HTMLCanvasElement> };

interface RenderEditState {
  /** Render being edited in the full-size viewer; null when edits target the canvas image. */
  targetJobId: string | null;
  tool: RenderEditTool;
  /** Brush diameter in screen pixels; converted to image pixels when a stroke is drawn. */
  brushSize: number;
  strokes: RenderMaskStroke[];
  /** Edit job queued from the viewer — shown in Compare once it finishes. */
  awaitingJobId: string | null;
  setTool: (tool: RenderEditTool) => void;
  setBrushSize: (size: number) => void;
  addStroke: (stroke: RenderMaskStroke) => void;
  undo: () => void;
  clearStrokes: () => void;
  setAwaitingJob: (id: string | null) => void;
  stopEditing: () => void;
}

export const useRenderEditStore = create<RenderEditState>((set) => ({
  targetJobId: null,
  tool: "brush",
  brushSize: 36,
  strokes: [],
  awaitingJobId: null,
  setTool: (tool) => set({ tool }),
  setBrushSize: (brushSize) => set({ brushSize }),
  addStroke: (stroke) => set((state) => ({ strokes: [...state.strokes, stroke] })),
  undo: () => set((state) => ({ strokes: state.strokes.slice(0, -1) })),
  clearStrokes: () => set({ strokes: [] }),
  setAwaitingJob: (awaitingJobId) => set({ awaitingJobId }),
  stopEditing: () => set({ targetJobId: null, strokes: [] }),
}));

/** Opens a finished render full-size in edit mode and points the Edit tab at it. */
export function startRenderEdit(jobId: string) {
  const { targetJobId } = useRenderEditStore.getState();
  useRenderEditStore.setState(targetJobId === jobId ? {} : { targetJobId: jobId, strokes: [] });
  useRenderJobsStore.getState().setPreviewJob(jobId);
  useCanvasStore.getState().setActiveTab("edit");
}

/** True when the selection has anything to keep (erasing everything leaves it empty in practice, but that's rare). */
export function hasSelection(strokes: RenderMaskStroke[]): boolean {
  return strokes.some((stroke) => stroke.kind !== "eraser");
}

/**
 * Turns an automatic selection's white-on-black PNG into a stroke. White becomes opaque
 * and black transparent, so it paints like any other mark and the eraser still works.
 */
export async function maskStrokeFrom(dataUrl: string): Promise<RenderMaskStroke> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const selected = pixels.data[index]! > 127;
    pixels.data[index] = 255;
    pixels.data[index + 1] = 255;
    pixels.data[index + 2] = 255;
    pixels.data[index + 3] = selected ? 255 : 0;
  }
  context.putImageData(pixels, 0, 0);
  return { kind: "mask", image: canvas, width: canvas.width, height: canvas.height };
}

/** The stencil recoloured, cached per colour so redraws while painting stay cheap. */
function tintedMask(stroke: Extract<RenderMaskStroke, { kind: "mask" }>, colour: string): HTMLCanvasElement {
  const cache = (stroke.tinted ??= new Map());
  const existing = cache.get(colour);
  if (existing) return existing;
  const canvas = document.createElement("canvas");
  canvas.width = stroke.width;
  canvas.height = stroke.height;
  const context = canvas.getContext("2d")!;
  context.drawImage(stroke.image, 0, 0, stroke.width, stroke.height);
  context.globalCompositeOperation = "source-in";
  context.fillStyle = colour;
  context.fillRect(0, 0, canvas.width, canvas.height);
  cache.set(colour, canvas);
  return canvas;
}

/** Draws the strokes onto a 2D context already scaled to image space; `add`/`remove` are fill colours. */
export function drawStrokes(context: CanvasRenderingContext2D, strokes: RenderMaskStroke[], add: string, remove: string | null) {
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const stroke of strokes) {
    const erasing = stroke.kind === "eraser";
    context.globalCompositeOperation = erasing && remove === null ? "destination-out" : "source-over";
    const colour = erasing ? (remove ?? "#000") : add;
    context.fillStyle = colour;
    context.strokeStyle = colour;

    if (stroke.kind === "mask") {
      context.drawImage(tintedMask(stroke, colour), 0, 0, stroke.width, stroke.height);
    } else if (stroke.kind === "rectangle") {
      context.fillRect(stroke.x, stroke.y, stroke.width, stroke.height);
    } else if (stroke.kind === "polygon") {
      context.beginPath();
      for (let index = 0; index < stroke.points.length; index += 2) {
        if (index === 0) context.moveTo(stroke.points[0]!, stroke.points[1]!);
        else context.lineTo(stroke.points[index]!, stroke.points[index + 1]!);
      }
      context.closePath();
      context.fill();
    } else if (stroke.points.length === 2) {
      context.beginPath();
      context.arc(stroke.points[0]!, stroke.points[1]!, stroke.size / 2, 0, Math.PI * 2);
      context.fill();
    } else {
      context.lineWidth = stroke.size;
      context.beginPath();
      for (let index = 0; index < stroke.points.length; index += 2) {
        if (index === 0) context.moveTo(stroke.points[0]!, stroke.points[1]!);
        else context.lineTo(stroke.points[index]!, stroke.points[index + 1]!);
      }
      context.stroke();
    }
  }
  context.globalCompositeOperation = "source-over";
}

/** White-on-black edit mask at the image's natural size — same format as the canvas selection masks. */
export function buildStrokeMask(strokes: RenderMaskStroke[], naturalSize: { width: number; height: number }): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = naturalSize.width;
  canvas.height = naturalSize.height;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("Canvas 2D context unavailable"));
  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  drawStrokes(context, strokes, "#fff", "#000");
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't encode mask"))), "image/png");
  });
}
