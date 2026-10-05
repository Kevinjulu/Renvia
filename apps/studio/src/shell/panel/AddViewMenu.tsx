import { useEffect, useRef, useState } from "react";
import { EXTRA_VIEW_PRESETS } from "../../canvas/buildingViews";
import { useCanvasStore } from "../../canvas/hooks/useCanvasStore";
import { useMenu } from "../../lib/useMenu";

interface AddViewMenuProps {
  className?: string;
  compact?: boolean;
}

function PlusGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function AddViewMenu({ className, compact = false }: AddViewMenuProps) {
  const addBuildingView = useCanvasStore((state) => state.addBuildingView);
  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = () => {
    setOpen(false);
    setCustomOpen(false);
    setCustomName("");
  };
  const { menuRef, triggerRef, onMenuKeyDown } = useMenu<HTMLDivElement>({ open, onClose: close, rootRef });

  useEffect(() => {
    if (customOpen) inputRef.current?.focus();
  }, [customOpen]);

  const add = (label: string) => {
    addBuildingView(label);
    close();
    triggerRef.current?.focus();
  };

  return (
    <div ref={rootRef} className={`add-view-menu ${className ?? ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className={compact ? "add-view" : "add-view-trigger"}
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {compact ? (
          <>
            <span><PlusGlyph /></span>
            <small>Add elevation</small>
          </>
        ) : (
          <>
            <PlusGlyph /> Add elevation
          </>
        )}
      </button>
      {open && (
        <div
          ref={menuRef}
          className={`add-view-popover ${compact ? "is-up" : ""}`}
          role="menu"
          aria-label="Add elevation"
          onKeyDown={onMenuKeyDown}
        >
          {EXTRA_VIEW_PRESETS.map((label) => (
            <button key={label} type="button" role="menuitem" onClick={() => add(label)}>
              {label}
            </button>
          ))}
          {customOpen ? (
            <form
              className="add-view-custom"
              onSubmit={(event) => {
                event.preventDefault();
                if (customName.trim()) add(customName.trim());
              }}
            >
              <input
                ref={inputRef}
                value={customName}
                onChange={(event) => setCustomName(event.target.value)}
                placeholder="Custom name"
                maxLength={40}
                aria-label="Custom elevation name"
              />
              <button type="submit" disabled={!customName.trim()}>
                Add
              </button>
            </form>
          ) : (
            <button type="button" role="menuitem" onClick={() => setCustomOpen(true)}>
              Custom…
            </button>
          )}
        </div>
      )}
    </div>
  );
}
