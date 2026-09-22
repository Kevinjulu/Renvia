import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface ProjectCardMenuProps {
  onRename: () => void;
  onDelete: () => void;
}

/** Matches the menu's w-40 (10rem) Tailwind width, used to right-align it under the button. */
const MENU_WIDTH = 160;

export function ProjectCardMenu({ onRename, onDelete }: ProjectCardMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const updatePosition = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({ top: rect.bottom + 6, left: rect.right - MENU_WIDTH });
  };

  useEffect(() => {
    if (!open) return;
    updatePosition();

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    // The dashboard's card grid scrolls with the page — keep the menu pinned under the button.
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        aria-label="Project options"
        aria-expanded={open}
        aria-haspopup="menu"
        className={`flex h-7 w-7 items-center justify-center rounded-full bg-white/90 backdrop-blur transition-opacity ${
          open ? "opacity-100 text-primary" : "text-faint opacity-0 group-hover:opacity-100"
        }`}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="8" cy="3.4" r="1.3" />
          <circle cx="8" cy="8" r="1.3" />
          <circle cx="8" cy="12.6" r="1.3" />
        </svg>
      </button>

      {/* Rendered at document.body — a card's own stacking/compositing context (hover
          transform, thumbnail image) must never be able to clip or paint over this. */}
      {open &&
        position &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="fixed z-50 w-40 overflow-hidden rounded-lg border border-hairline bg-white py-1 shadow-xl"
            style={{ top: position.top, left: position.left }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={(event) => {
                event.stopPropagation();
                setOpen(false);
                onRename();
              }}
              className="flex w-full items-center px-3.5 py-2 text-left text-sm text-primary transition-colors hover:bg-surface-muted"
            >
              Rename
            </button>
            <div className="my-1 h-px bg-hairline" />
            <button
              type="button"
              role="menuitem"
              onClick={(event) => {
                event.stopPropagation();
                setOpen(false);
                onDelete();
              }}
              className="flex w-full items-center px-3.5 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50"
            >
              Delete
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
