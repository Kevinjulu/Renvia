import type { AspectRatio } from "@renvia/types";

/** Shape drawn for each ratio, scaled to fit a small consistent box. */
const RATIOS: { id: AspectRatio; label: string; hint: string; w: number; h: number }[] = [
  { id: "auto", label: "Auto", hint: "Match the source image's own shape", w: 10, h: 10 },
  { id: "1:1", label: "1:1", hint: "Square — social posts, tiles", w: 10, h: 10 },
  { id: "16:9", label: "16:9", hint: "Wide — hero shots, presentations", w: 14, h: 8 },
  { id: "4:3", label: "4:3", hint: "Landscape — standard elevation crop", w: 13, h: 10 },
  { id: "3:4", label: "3:4", hint: "Portrait — tall facades, narrow streets", w: 10, h: 13 },
  { id: "9:16", label: "9:16", hint: "Tall — mobile, story format", w: 8, h: 14 },
];

function RatioGlyph({ w, h, auto }: { w: number; h: number; auto?: boolean }) {
  const size = 16;
  const x = (size - w) / 2;
  const y = (size - h) / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={1.2}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.2}
        strokeDasharray={auto ? "1.6 1.4" : undefined}
      />
    </svg>
  );
}

interface AspectRatioPickerProps {
  value: AspectRatio;
  onChange: (ratio: AspectRatio) => void;
}

/**
 * What fal actually supports for these models: an aspect ratio, not a resolution tier —
 * none of the three routes upscale to 2K/4K, so this replaces the old (fake) 1K/2K/4K picker.
 */
export function AspectRatioPicker({ value, onChange }: AspectRatioPickerProps) {
  return (
    <div>
      <p className="text-sm font-medium text-primary">Aspect ratio</p>
      <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg bg-surface-muted p-1">
        {RATIOS.map((ratio) => {
          const isActive = value === ratio.id;
          return (
            <button
              key={ratio.id}
              type="button"
              title={ratio.hint}
              onClick={() => onChange(ratio.id)}
              aria-pressed={isActive}
              className={`flex flex-col items-center gap-0.5 rounded-md py-1.5 text-xs font-medium transition-all ${
                isActive ? "bg-white text-primary shadow-sm" : "text-secondary hover:text-primary"
              }`}
            >
              <RatioGlyph w={ratio.w} h={ratio.h} auto={ratio.id === "auto"} />
              {ratio.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
