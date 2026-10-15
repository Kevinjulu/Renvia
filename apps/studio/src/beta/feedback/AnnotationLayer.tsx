import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { BetaAnnotations } from "@renvia/types";
import { boxFrom, LIMITS, normalize, simplifyStroke, type Point } from "./annotations";

export type AnnotateTool = "pin" | "box" | "draw";

const pct = (value: number) => `${value * 100}%`;

/** The marks, drawn over an image in its own coordinate space; read-only unless `onChange` is given. */
export function AnnotationMarks({ annotations, draft }: { annotations: BetaAnnotations; draft?: { box?: ReturnType<typeof boxFrom>; stroke?: Point[] } }) {
  return (
    <>
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
        {annotations.boxes.map((box, index) => (
          <rect key={`b${index}`} x={box.x * 1000} y={box.y * 1000} width={box.w * 1000} height={box.h * 1000} fill="rgba(239,68,68,0.12)" stroke="#ef4444" strokeWidth="4" vectorEffect="non-scaling-stroke" />
        ))}
        {draft?.box && <rect x={draft.box.x * 1000} y={draft.box.y * 1000} width={draft.box.w * 1000} height={draft.box.h * 1000} fill="none" stroke="#ef4444" strokeDasharray="6 4" strokeWidth="3" vectorEffect="non-scaling-stroke" />}
        {[...annotations.strokes.map((stroke) => stroke.points), ...(draft?.stroke ? [draft.stroke] : [])].map((points, index) => (
          <polyline key={`s${index}`} points={points.map(([x, y]) => `${x * 1000},${y * 1000}`).join(" ")} fill="none" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      {annotations.pins.map((pin, index) => (
        <span
          key={`p${index}`}
          className="pointer-events-none absolute grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white bg-red-500 text-[11px] font-bold text-white shadow"
          style={{ left: pct(pin.x), top: pct(pin.y) }}
          title={pin.label}
        >
          {index + 1}
        </span>
      ))}
    </>
  );
}

/**
 * An image the tester marks: click to pin, drag a box, or draw. Coordinates are fractions of the
 * image, so the team sees each mark in exactly the same place at any size.
 */
export function AnnotateImage({
  src,
  annotations,
  tool,
  onChange,
}: {
  src: string;
  annotations: BetaAnnotations;
  tool: AnnotateTool;
  onChange: (next: BetaAnnotations) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState<Point | null>(null);
  const [current, setCurrent] = useState<Point | null>(null);
  const [stroke, setStroke] = useState<Point[] | null>(null);

  const point = (event: ReactPointerEvent) => normalize(event.clientX, event.clientY, frameRef.current!.getBoundingClientRect());

  const onDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const at = point(event);
    if (tool === "pin") {
      if (annotations.pins.length >= LIMITS.pins) return;
      onChange({ ...annotations, pins: [...annotations.pins, { x: at[0], y: at[1] }] });
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "box" && annotations.boxes.length < LIMITS.boxes) {
      setStart(at);
      setCurrent(at);
    }
    if (tool === "draw" && annotations.strokes.length < LIMITS.strokes) setStroke([at]);
  };

  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (start) setCurrent(point(event));
    if (stroke) setStroke((points) => (points ? [...points, point(event)] : points));
  };

  const onUp = () => {
    if (start && current) {
      const box = boxFrom(start, current);
      // A click without a drag isn't a box.
      if (box.w > 0.01 && box.h > 0.01) onChange({ ...annotations, boxes: [...annotations.boxes, box] });
    }
    if (stroke && stroke.length > 1) onChange({ ...annotations, strokes: [...annotations.strokes, { points: simplifyStroke(stroke) }] });
    setStart(null);
    setCurrent(null);
    setStroke(null);
  };

  return (
    <div
      ref={frameRef}
      className={`relative select-none overflow-hidden rounded-lg border border-hairline bg-surface-muted ${tool === "pin" ? "cursor-crosshair" : "cursor-cell"}`}
      style={{ touchAction: "none" }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <img src={src} alt="The render you're reporting" className="block w-full" draggable={false} />
      <AnnotationMarks annotations={annotations} draft={{ box: start && current ? boxFrom(start, current) : undefined, stroke: stroke ?? undefined }} />
    </div>
  );
}
