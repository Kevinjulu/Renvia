import { useId, useRef, useState } from "react";
import { useMenu } from "../../lib/useMenu";

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

const STYLE_THUMBS: Record<string, string> = {
  Photorealistic: "/style-thumbs/photorealistic-sm.jpg",
  "Vector sketch": "/style-thumbs/vector-sketch-sm.jpg",
  "Watercolor sketch": "/style-thumbs/watercolor-sketch-sm.jpg",
  "Watercolor collage": "/style-thumbs/watercolor-collage-sm.jpg",
};

function StyleSwatch({ styleId }: { styleId: string }) {
  return <img src={STYLE_THUMBS[styleId] ?? STYLE_THUMBS.Photorealistic} alt="" className="style-swatch-art" draggable={false} />;
}

interface StylePickerProps {
  value: string;
  onChange: (style: string) => void;
}

export function StylePicker({ value, onChange }: StylePickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = STYLE_OPTIONS.find((option) => option.id === value) ?? STYLE_OPTIONS[0]!;
  const { menuRef, triggerRef, onMenuKeyDown } = useMenu<HTMLDivElement>({ open, onClose: () => setOpen(false), rootRef: containerRef });
  const id = useId();
  const labelId = `${id}-label`;
  const valueId = `${id}-value`;

  return (
    <div ref={containerRef} className="style-picker relative">
      <p className="cp-field-label" id={labelId}>Style</p>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby={`${labelId} ${valueId}`}
        className={`style-picker-trigger ${open ? "is-open" : ""}`}
      >
        <span className="style-swatch">
          <StyleSwatch styleId={selected.id} />
        </span>
        <span className="style-picker-label" id={valueId}>{selected.label}</span>
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
        <div ref={menuRef} className="style-picker-menu" role="listbox" aria-labelledby={labelId} onKeyDown={onMenuKeyDown}>
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
                  triggerRef.current?.focus();
                }}
                className={`style-picker-option ${isSelected ? "is-selected" : ""}`}
              >
                <span className="style-swatch">
                  <StyleSwatch styleId={option.id} />
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
