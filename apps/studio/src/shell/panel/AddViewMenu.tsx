import { useEffect, useRef, useState } from "react";
import { EXTRA_VIEW_PRESETS } from "../../canvas/buildingViews";
import { useCanvasStore } from "../../canvas/hooks/useCanvasStore";

interface AddViewMenuProps {
  className?: string;
  compact?: boolean;
}

export function AddViewMenu({ className, compact = false }: AddViewMenuProps) {
  const addBuildingView = useCanvasStore((state) => state.addBuildingView);
  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setCustomOpen(false);
        setCustomName("");
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (customOpen) inputRef.current?.focus();
  }, [customOpen]);

  const add = (label: string) => {
    addBuildingView(label);
    setOpen(false);
    setCustomOpen(false);
    setCustomName("");
  };

  return (
    <div ref={rootRef} className={`add-view-menu ${className ?? ""}`}>
      <button
        type="button"
        className={compact ? "add-view" : "add-view-trigger"}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        {compact ? (
          <>
            <span>＋</span>
            <small>Add view</small>
          </>
        ) : (
          "＋ Add view"
        )}
      </button>
      {open && (
        <div className={`add-view-popover ${compact ? "is-up" : ""}`} role="menu">
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
                aria-label="Custom view name"
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
