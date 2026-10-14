import { useMemo } from "react";
import type { EditSelectionArea } from "@renvia/types";
import { drawStrokes, hasSelection, useRenderEditStore, type AreaTag, type RenderMaskStroke } from "../hooks/useRenderEditStore";

/** Long side of the grid the selection is analysed on; plenty to tell a door from a window. */
const GRID = 256;
/** Marks this close on the grid (about 1% of the image) count as one area, e.g. two brush strokes on one door. */
const JOIN_DISTANCE = 2;
/** Specks smaller than this many grid cells are stray marks, not areas. */
const MIN_CELLS = 4;
/** The most areas an edit names; any beyond are still edited, just not described. */
export const MAX_AREAS = 8;

type Size = { width: number; height: number };

export interface SelectionArea extends EditSelectionArea {
  id: number;
  /** A point inside the area (image pixels), where a new tag for it is pinned. */
  anchor: { x: number; y: number };
}

export interface SelectionAnalysis {
  /** Separate areas, largest first. */
  areas: SelectionArea[];
  /** The areas the latest mark touched: the ones a quick pick tags. */
  activeIds: number[];
  /** The area under an image point, or null. */
  areaAt: (point: { x: number; y: number }) => number | null;
}

const EMPTY: SelectionAnalysis = { areas: [], activeIds: [], areaAt: () => null };

/** The strokes as a 0/1 grid of `width` x `height` cells. */
function rasterize(strokes: RenderMaskStroke[], scale: number, width: number, height: number): Uint8Array {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const cells = new Uint8Array(width * height);
  if (!context) return cells;
  context.setTransform(scale, 0, 0, scale, 0, 0);
  drawStrokes(context, strokes, "#fff", null);
  const { data } = context.getImageData(0, 0, width, height);
  for (let index = 0; index < cells.length; index++) cells[index] = data[index * 4 + 3]! > 127 ? 1 : 0;
  return cells;
}

/** Grows the selected cells by `radius` so marks that nearly touch join into one area. */
function dilate(cells: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const grown = new Uint8Array(cells.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!cells[y * width + x]) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        const row = y + dy;
        if (row < 0 || row >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const column = x + dx;
          if (column >= 0 && column < width) grown[row * width + column] = 1;
        }
      }
    }
  }
  return grown;
}

/**
 * Splits the selection into its separate areas, gives each the latest tag pinned inside it, and
 * finds the areas the latest mark touched. Pure apart from drawing on an offscreen canvas.
 */
export function analyzeSelection(strokes: RenderMaskStroke[], size: Size | null, tags: AreaTag[]): SelectionAnalysis {
  if (!size || !size.width || !size.height || !hasSelection(strokes)) return EMPTY;
  const scale = GRID / Math.max(size.width, size.height);
  const width = Math.max(1, Math.round(size.width * scale));
  const height = Math.max(1, Math.round(size.height * scale));
  const cells = rasterize(strokes, scale, width, height);
  const joined = dilate(cells, width, height, JOIN_DISTANCE);

  // Connected regions of the joined grid; boxes and sizes count only truly selected cells.
  const regionOf = new Int32Array(cells.length).fill(-1);
  const regions: { cells: number; minX: number; minY: number; maxX: number; maxY: number; anchor: number }[] = [];
  const queue = new Int32Array(cells.length);
  for (let start = 0; start < cells.length; start++) {
    if (!joined[start] || regionOf[start] !== -1) continue;
    const region = { cells: 0, minX: width, minY: height, maxX: -1, maxY: -1, anchor: -1 };
    const id = regions.length;
    regions.push(region);
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    regionOf[start] = id;
    while (head < tail) {
      const at = queue[head++]!;
      const x = at % width;
      const y = (at - x) / width;
      if (cells[at]) {
        region.cells++;
        if (region.anchor === -1) region.anchor = at;
        if (x < region.minX) region.minX = x;
        if (x > region.maxX) region.maxX = x;
        if (y < region.minY) region.minY = y;
        if (y > region.maxY) region.maxY = y;
      }
      const neighbours = [x > 0 ? at - 1 : -1, x < width - 1 ? at + 1 : -1, y > 0 ? at - width : -1, y < height - 1 ? at + width : -1];
      for (const next of neighbours) {
        if (next >= 0 && joined[next] && regionOf[next] === -1) {
          regionOf[next] = id;
          queue[tail++] = next;
        }
      }
    }
  }

  const areaAt = (point: { x: number; y: number }) => {
    const x = Math.floor(point.x * scale);
    const y = Math.floor(point.y * scale);
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    const id = regionOf[y * width + x]!;
    return id >= 0 && regions[id]!.cells >= MIN_CELLS ? id : null;
  };

  const labels = new Map<number, string>();
  for (const tag of tags) {
    const id = areaAt(tag);
    if (id !== null) labels.set(id, tag.label);
  }

  const toImage = (cell: number) => cell / scale;
  const areas: SelectionArea[] = regions
    .map((region, id) => ({ region, id }))
    .filter(({ region }) => region.cells >= MIN_CELLS)
    .sort((a, b) => b.region.cells - a.region.cells)
    .map(({ region, id }) => {
      const anchorX = region.anchor % width;
      const anchorY = (region.anchor - anchorX) / width;
      const label = labels.get(id);
      return {
        id,
        box: {
          left: Math.round(toImage(region.minX)),
          top: Math.round(toImage(region.minY)),
          width: Math.max(1, Math.round(toImage(region.maxX + 1) - toImage(region.minX))),
          height: Math.max(1, Math.round(toImage(region.maxY + 1) - toImage(region.minY))),
        },
        anchor: { x: toImage(anchorX + 0.5), y: toImage(anchorY + 0.5) },
        ...(label ? { label } : {}),
      };
    });

  // The latest mark that adds to the selection decides which areas a quick pick tags.
  const latest = [...strokes].reverse().find((stroke) => stroke.kind !== "eraser");
  const touched = new Set<number>();
  if (latest) {
    const own = rasterize([latest], scale, width, height);
    for (let index = 0; index < own.length; index++) {
      if (own[index] && cells[index] && regionOf[index]! >= 0) touched.add(regionOf[index]!);
    }
  }
  const valid = new Set(areas.map((area) => area.id));
  const activeIds = [...touched].filter((id) => valid.has(id));
  return { areas, activeIds: activeIds.length > 0 ? activeIds : areas.slice(0, 1).map((area) => area.id), areaAt };
}

/** The current selection's areas, recomputed only when the marks, tags or image change. */
export function useSelectionAreas(): SelectionAnalysis {
  const strokes = useRenderEditStore((state) => state.strokes);
  const imageSize = useRenderEditStore((state) => state.imageSize);
  const areaTags = useRenderEditStore((state) => state.areaTags);
  return useMemo(() => analyzeSelection(strokes, imageSize, areaTags), [strokes, imageSize, areaTags]);
}

/** Tags the areas the latest mark touched (or clears their tags with null). */
export function tagLatestAreas(label: string | null) {
  const { strokes, imageSize, areaTags, setAreaTags } = useRenderEditStore.getState();
  const { areas, activeIds, areaAt } = analyzeSelection(strokes, imageSize, areaTags);
  const active = new Set(activeIds);
  const kept = areaTags.filter((tag) => {
    const id = areaAt(tag);
    return id === null ? false : !active.has(id);
  });
  const text = label?.trim();
  const added = text ? areas.filter((area) => active.has(area.id)).map((area) => ({ ...area.anchor, label: text })) : [];
  setAreaTags([...kept, ...added]);
}

/** The areas as the edit request sends them: at most MAX_AREAS, largest first. */
export function areasForRequest(areas: SelectionArea[]): EditSelectionArea[] {
  return areas.slice(0, MAX_AREAS).map(({ box, label }) => ({ box, ...(label ? { label } : {}) }));
}
