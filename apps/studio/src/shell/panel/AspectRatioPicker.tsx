import { useEffect, useRef, useState } from "react";
import type { AspectRatio } from "@renvia/types";
import { useCanvasStore } from "../../canvas/hooks/useCanvasStore";
import { nodeForView } from "../../canvas/buildingViews";

/** Shape drawn for each ratio, scaled to fit a small consistent box. */
const RATIOS: { id: Exclude<AspectRatio, "auto">; hint: string; w: number; h: number }[] = [
  { id: "1:1", hint: "Square — social posts, tiles", w: 10, h: 10 },
  { id: "16:9", hint: "Wide — hero shots, presentations", w: 14, h: 8 },
  { id: "4:3", hint: "Landscape — standard elevation crop", w: 13, h: 10 },
  { id: "3:4", hint: "Portrait — tall facades, narrow streets", w: 10, h: 13 },
  { id: "9:16", hint: "Tall — mobile, story format", w: 8, h: 14 },
];

/** Common ratios used to name an upload's shape; anything else is shown as "1.62:1". */
const NAMED_RATIOS: [string, number][] = [
  ["1:1", 1], ["5:4", 5 / 4], ["4:3", 4 / 3], ["3:2", 3 / 2], ["16:10", 16 / 10], ["16:9", 16 / 9], ["2:1", 2], ["21:9", 21 / 9],
  ["4:5", 4 / 5], ["3:4", 3 / 4], ["2:3", 2 / 3], ["9:16", 9 / 16],
];

function describeRatio(width: number, height: number) {
  const ratio = width / height;
  const named = NAMED_RATIOS.find(([, value]) => Math.abs(value - ratio) / value < 0.03);
  if (named) return named[0];
  return ratio >= 1 ? `${ratio.toFixed(2)}:1` : `1:${(1 / ratio).toFixed(2)}`;
}

/** Scales a width/height into the 16px glyph box. */
function glyphSize(width: number, height: number) {
  const scale = 14 / Math.max(width, height);
  return { w: Math.max(5, width * scale), h: Math.max(5, height * scale) };
}

function RatioGlyph({ w, h, dashed }: { w: number; h: number; dashed?: boolean }) {
  const size = 16;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <rect
        x={(size - w) / 2}
        y={(size - h) / 2}
        width={w}
        height={h}
        rx={1.2}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.3}
        strokeDasharray={dashed ? "1.6 1.4" : undefined}
      />
    </svg>
  );
}

interface AspectRatioPickerProps {
  value: AspectRatio;
  onChange: (ratio: AspectRatio) => void;
}

/**
 * What fal actually supports for these models: an aspect ratio, not a resolution tier.
 * Auto — the default — keeps the uploaded elevation's own shape, so it's shown as that shape.
 */
export function AspectRatioPicker({ value, onChange }: AspectRatioPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const source = useCanvasStore((state) => nodeForView(state.nodes, state.activeViewId));
  const sourceLabel = source ? describeRatio(source.width, source.height) : null;
  const sourceGlyph = source ? glyphSize(source.width, source.height) : { w: 12, h: 10 };
  const fixed = RATIOS.find((ratio) => ratio.id === value);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (ratio: AspectRatio) => {
    onChange(ratio);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="cp-ratio">
      <p className="cp-field-label">Aspect ratio</p>
      <button
        type="button"
        className={`cp-ratio-trigger ${open ? "is-open" : ""}`}
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="cp-ratio-glyph">
          {fixed ? <RatioGlyph w={fixed.w} h={fixed.h} /> : <RatioGlyph {...sourceGlyph} dashed />}
        </span>
        <span className="cp-ratio-text">
          <strong>{fixed ? fixed.id : sourceLabel ?? "Auto"}</strong>
          <small>{fixed ? "Fixed" : sourceLabel ? "Auto" : "Fits upload"}</small>
        </span>
        <svg className="cp-caret" width="11" height="11" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M2 3.5 5 6.5l3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="cp-ratio-menu" role="listbox" aria-label="Aspect ratio">
          <button
            type="button"
            role="option"
            aria-selected={value === "auto"}
            className={`cp-ratio-auto ${value === "auto" ? "is-selected" : ""}`}
            onClick={() => choose("auto")}
          >
            <RatioGlyph {...sourceGlyph} dashed />
            <span>
              <strong>Match upload{sourceLabel ? ` · ${sourceLabel}` : ""}</strong>
              <small>Keeps your elevation's own shape</small>
            </span>
          </button>
          <div className="cp-ratio-grid">
            {RATIOS.map((ratio) => (
              <button
                key={ratio.id}
                type="button"
                role="option"
                aria-selected={value === ratio.id}
                title={ratio.hint}
                className={value === ratio.id ? "is-selected" : ""}
                onClick={() => choose(ratio.id)}
              >
                <RatioGlyph w={ratio.w} h={ratio.h} />
                {ratio.id}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
