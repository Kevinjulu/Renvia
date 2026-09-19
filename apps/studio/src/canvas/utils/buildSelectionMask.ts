import type { SelectionShape } from "../hooks/useSelectionToolStore";

/**
 * Renders a selection as an inpainting mask: white marks the area to edit, black is kept.
 * Selections are in the canvas node's display space, so they're scaled up to the image's
 * natural size — inpainting models require the mask to match the source image exactly.
 */
export function buildSelectionMask(
  selection: SelectionShape,
  displaySize: { width: number; height: number },
  naturalSize: { width: number; height: number },
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = naturalSize.width;
  canvas.height = naturalSize.height;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("Canvas 2D context unavailable"));

  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#fff";
  context.scale(naturalSize.width / displaySize.width, naturalSize.height / displaySize.height);

  if (selection.type === "rectangle") {
    context.fillRect(selection.x, selection.y, selection.width, selection.height);
  } else {
    context.beginPath();
    for (let index = 0; index < selection.points.length; index += 2) {
      const x = selection.points[index]!;
      const y = selection.points[index + 1]!;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.closePath();
    context.fill();
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't encode mask"))), "image/png");
  });
}
