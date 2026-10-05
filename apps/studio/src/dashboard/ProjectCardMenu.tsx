import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMenu } from "../lib/useMenu";

interface ProjectCardMenuProps {
  onRename: () => void;
  onDelete: () => void;
}

/** Matches the menu's w-40 (10rem) Tailwind width, used to right-align it under the button. */
const MENU_WIDTH = 160;

export function ProjectCardMenu({ onRename, onDelete }: ProjectCardMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const { menuRef, triggerRef, onMenuKeyDown } = useMenu<HTMLDivElement>({ open: open && position !== null, onClose: () => setOpen(false) });

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({ top: rect.bottom + 6, left: rect.right - MENU_WIDTH });
    };
    updatePosition();
    // The dashboard's card grid scrolls with the page — keep the menu pinned under the button.
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, triggerRef]);

  const choose = (action: () => void) => {
    setOpen(false);
    triggerRef.current?.focus();
    action();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        aria-label="Project options"
        aria-expanded={open}
        aria-haspopup="menu"
        className={`project-card-reveal flex h-7 w-7 items-center justify-center rounded-full bg-white/90 backdrop-blur transition-opacity focus-visible:opacity-100 ${
          open ? "opacity-100 text-primary" : "text-faint opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
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
            aria-label="Project options"
            onKeyDown={onMenuKeyDown}
            className="fixed z-50 w-40 overflow-hidden rounded-lg border border-hairline bg-white py-1 shadow-xl"
            style={{ top: position.top, left: position.left }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={(event) => {
                event.stopPropagation();
                choose(onRename);
              }}
              className="flex w-full items-center px-3.5 py-2 text-left text-sm text-primary transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none"
            >
              Rename
            </button>
            <div className="my-1 h-px bg-hairline" role="separator" />
            <button
              type="button"
              role="menuitem"
              onClick={(event) => {
                event.stopPropagation();
                choose(onDelete);
              }}
              className="flex w-full items-center px-3.5 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50 focus-visible:bg-red-50 focus-visible:outline-none"
            >
              Delete
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
