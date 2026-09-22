import { useEffect, useRef, useState } from "react";

interface ProjectCardMenuProps {
  onRename: () => void;
  onDelete: () => void;
}

export function ProjectCardMenu({ onRename, onDelete }: ProjectCardMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
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

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-9 z-20 w-40 overflow-hidden rounded-lg border border-hairline bg-white py-1 shadow-xl"
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
        </div>
      )}
    </div>
  );
}
