import { useEffect, useRef, useState } from "react";

export interface StyleOption {
  id: string;
  label: string;
  thumbnail: string;
}

export const STYLE_OPTIONS: StyleOption[] = [
  { id: "Photorealistic", label: "Photorealistic", thumbnail: "/style-thumbs/photorealistic.jpg" },
  { id: "Vector sketch", label: "Vector sketch", thumbnail: "/style-thumbs/vector-sketch.jpg" },
  { id: "Watercolor sketch", label: "Watercolor sketch", thumbnail: "/style-thumbs/watercolor-sketch.jpg" },
  { id: "Watercolor collage", label: "Watercolor collage", thumbnail: "/style-thumbs/watercolor-collage.jpg" },
];

interface StylePickerProps {
  value: string;
  onChange: (style: string) => void;
}

export function StylePicker({ value, onChange }: StylePickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = STYLE_OPTIONS.find((option) => option.id === value) ?? STYLE_OPTIONS[0]!;

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <p className="text-sm font-medium text-primary">Style</p>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="mt-2 flex w-full items-center gap-3 rounded-lg border border-hairline px-3 py-2 text-left transition-colors hover:border-hairline-strong"
      >
        <img
          src={selected.thumbnail}
          alt=""
          aria-hidden="true"
          className="h-8 w-10 shrink-0 rounded-md object-cover"
        />
        <span className="flex-1 text-sm text-render-warm">{selected.label}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          aria-hidden="true"
          className={`shrink-0 text-faint transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M2 3.5 5 6.5l3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-10 mt-2 rounded-lg border border-hairline bg-white p-2 shadow-lg">
          {STYLE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                onChange(option.id);
                setOpen(false);
              }}
              className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface-muted"
            >
              <img
                src={option.thumbnail}
                alt=""
                aria-hidden="true"
                className="h-9 w-12 shrink-0 rounded-md object-cover"
              />
              <span className={`flex-1 text-sm ${option.id === value ? "text-render-warm" : "text-primary"}`}>
                {option.label}
              </span>
            </button>
          ))}
          <div className="flex justify-center pt-1">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true" className="text-faint">
              <path d="M2 3.5 5 6.5l3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}
