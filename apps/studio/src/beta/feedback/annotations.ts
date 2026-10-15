import type { BetaAnnotations } from "@renvia/types";

export type Point = [number, number];

export const LIMITS = { pins: 10, boxes: 5, strokes: 5, strokePoints: 64 } as const;

export function emptyAnnotations(image: BetaAnnotations["image"] = "result"): BetaAnnotations {
  return { v: 1, image, pins: [], boxes: [], strokes: [] };
}

export function hasMarks(annotations: BetaAnnotations): boolean {
  return annotations.pins.length + annotations.boxes.length + annotations.strokes.length > 0;
}

const round = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;

/** A pointer position as a fraction of the image box (0–1), so marks survive any zoom or resize. */
export function normalize(clientX: number, clientY: number, rect: DOMRect): Point {
  return [round((clientX - rect.left) / rect.width), round((clientY - rect.top) / rect.height)];
}

/** A dragged box with its corner at the top-left, whichever way it was drawn. */
export function boxFrom([x1, y1]: Point, [x2, y2]: Point) {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: round(Math.abs(x2 - x1)), h: round(Math.abs(y2 - y1)) };
}

function distanceToSegment([px, py]: Point, [ax, ay]: Point, [bx, by]: Point): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Ramer–Douglas–Peucker: drops points that sit within `epsilon` of the line through their neighbours. */
function rdp(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points;
  let maxDistance = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const distance = distanceToSegment(points[i]!, points[0]!, points[points.length - 1]!);
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }
  if (maxDistance <= epsilon) return [points[0]!, points[points.length - 1]!];
  return [...rdp(points.slice(0, index + 1), epsilon).slice(0, -1), ...rdp(points.slice(index), epsilon)];
}

/** A freehand stroke reduced to its shape in at most LIMITS.strokePoints points. */
export function simplifyStroke(points: Point[]): Point[] {
  let epsilon = 0.002;
  let simplified = rdp(points, epsilon);
  while (simplified.length > LIMITS.strokePoints) {
    epsilon *= 1.6;
    simplified = rdp(points, epsilon);
  }
  return simplified;
}
