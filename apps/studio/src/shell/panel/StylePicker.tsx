import { useEffect, useRef, useState } from "react";

export interface StyleOption {
  id: string;
  label: string;
  description: string;
}

export const STYLE_OPTIONS: StyleOption[] = [
  { id: "Photorealistic", label: "Photorealistic", description: "Lifelike materials and lighting" },
  { id: "Vector sketch", label: "Vector sketch", description: "Clean architectural line art" },
  { id: "Watercolor sketch", label: "Watercolor sketch", description: "Soft hand-painted washes" },
  { id: "Watercolor collage", label: "Watercolor collage", description: "Layered painted textures" },
];

function StyleSwatch({ styleId, uid }: { styleId: string; uid: string }) {
  switch (styleId) {
    case "Vector sketch":
      return (
        <svg viewBox="0 0 44 32" className="style-swatch-art" aria-hidden="true">
          <rect width="44" height="32" fill="#f5f7ff" />
          <g stroke="#3157ef" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 19 22 10 35 19" />
            <path d="M12 18v7h20v-7" />
            <rect x="19.5" y="19.5" width="5" height="5.5" />
            <path d="M27 19.5h4v3.5h-4z" />
          </g>
        </svg>
      );
    case "Watercolor sketch":
      return (
        <svg viewBox="0 0 44 32" className="style-swatch-art" aria-hidden="true">
          <rect width="44" height="32" fill="#fdfcfa" />
          <ellipse cx="16" cy="16" rx="13" ry="9" fill="#f3c8a8" opacity="0.55" />
          <ellipse cx="29" cy="18" rx="12" ry="8" fill="#a9c8e8" opacity="0.5" />
          <g stroke="#6b7280" strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 20 22 12 33 20" />
            <path d="M14 19v7h16v-7" />
          </g>
        </svg>
      );
    case "Watercolor collage":
      return (
        <svg viewBox="0 0 44 32" className="style-swatch-art" aria-hidden="true">
          <rect width="44" height="32" fill="#fbfaf7" />
          <rect x="4" y="7" width="18" height="16" rx="2" fill="#9ec5e8" opacity="0.7" transform="rotate(-6 13 15)" />
          <rect x="15" y="10" width="17" height="15" rx="2" fill="#e9b98f" opacity="0.7" transform="rotate(5 23 17)" />
          <rect x="24" y="6" width="16" height="17" rx="2" fill="#a8c8a0" opacity="0.7" transform="rotate(-4 32 14)" />
        </svg>
      );
    case "Photorealistic":
    default:
      return (
        <svg viewBox="0 0 44 32" className="style-swatch-art" aria-hidden="true">
          <defs>
            <linearGradient id={`pr-sky-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#cfe4ff" />
              <stop offset="1" stopColor="#eef5ff" />
            </linearGradient>
          </defs>
          <rect width="44" height="32" fill={`url(#pr-sky-${uid})`} />
          <circle cx="34" cy="9" r="4" fill="#ffd98a" />
          <rect y="22" width="44" height="10" fill="#d7e3c6" />
          <rect x="9" y="12" width="15" height="12" fill="#8a94a6" />
          <rect x="24" y="15" width="9" height="9" fill="#6f7889" />
          <g fill="#eaf1ff">
            <rect x="11.5" y="14.5" width="3" height="3" />
            <rect x="16" y="14.5" width="3" height="3" />
            <rect x="11.5" y="19" width="3" height="3" />
            <rect x="16" y="19" width="3" height="3" />
            <rect x="26" y="17" width="2.5" height="2.5" />
            <rect x="29.5" y="17" width="2.5" height="2.5" />
          </g>
        </svg>
      );
  }
}

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
    <div ref={containerRef} className="style-picker relative">
      <p className="text-sm font-medium text-primary">Style</p>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`style-picker-trigger ${open ? "is-open" : ""}`}
      >
        <span className="style-swatch">
          <StyleSwatch styleId={selected.id} uid="trigger" />
        </span>
        <span className="style-picker-label">{selected.label}</span>
        <svg
          width="11"
          height="11"
          viewBox="0 0 10 10"
          fill="none"
          aria-hidden="true"
          className={`style-picker-caret ${open ? "rotate-180" : ""}`}
        >
          <path d="M2 3.5 5 6.5l3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="style-picker-menu" role="listbox">
          {STYLE_OPTIONS.map((option) => {
            const isSelected = option.id === value;
            return (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(option.id);
                  setOpen(false);
                }}
                className={`style-picker-option ${isSelected ? "is-selected" : ""}`}
              >
                <span className="style-swatch">
                  <StyleSwatch styleId={option.id} uid={option.id.replace(/\s+/g, "-")} />
                </span>
                <span className="style-picker-option-text">
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
                {isSelected && (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="style-picker-check">
                    <path d="m3 7.5 2.5 2.5L11 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
