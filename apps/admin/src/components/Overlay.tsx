import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

let scrollLocks = 0;

/** Freezes page scroll while any overlay is open; nested overlays share one lock. */
function useScrollLock() {
  useEffect(() => {
    if (scrollLocks++ === 0) document.body.style.overflow = "hidden";
    return () => {
      if (--scrollLocks === 0) document.body.style.overflow = "";
    };
  }, []);
}

/**
 * Overlays render through a portal on <body>. Rendered in place they sit inside the page's
 * transformed `animate-rise-in` wrapper, which turns `fixed` into "fixed to the page" — on a
 * long page the dialog then opens far below the fold.
 */
function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}

/**
 * Centered dialog frame: always in the middle of the viewport, scrolls internally when the
 * content is taller than the screen. Pass `onClose` to close on a backdrop click.
 */
export function ModalFrame({ onClose, children }: { onClose?: () => void; children: ReactNode }) {
  useScrollLock();
  return (
    <Portal>
      <div className="fixed inset-0 z-50 overflow-y-auto bg-ink-950/55" onMouseDown={onClose}>
        <div className="flex min-h-full items-center justify-center p-4">
          <div className="w-full max-w-lg" onMouseDown={(event) => event.stopPropagation()}>{children}</div>
        </div>
      </div>
    </Portal>
  );
}

/** Right-hand detail panel pinned to the viewport; the child `<aside>` owns its own scrolling. */
export function DrawerFrame({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useScrollLock();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex justify-end bg-ink-950/55">
        <button type="button" className="absolute inset-0 cursor-default" aria-label="Close detail" onClick={onClose} />
        {children}
      </div>
    </Portal>
  );
}
