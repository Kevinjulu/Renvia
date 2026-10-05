import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.offsetParent !== null || element === document.activeElement,
  );
}

/**
 * Modal focus handling: moves focus into the dialog when it mounts, keeps Tab
 * cycling inside it, and restores focus to whatever was focused before on unmount.
 * Pass `initialFocus` to choose the first element; otherwise the first focusable wins.
 * `contain: false` keeps the focus move/restore but lets Tab leave — for overlays that
 * sit beside still-usable UI (the canvas previews leave the side panel interactive).
 */
export function useFocusTrap<T extends HTMLElement = HTMLDivElement>(
  active = true,
  initialFocus?: string,
  { contain = true }: { contain?: boolean } = {},
) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const target = (initialFocus ? root.querySelector<HTMLElement>(initialFocus) : null) ?? focusables(root)[0] ?? root;
    if (target === root && !root.hasAttribute("tabindex")) root.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (!contain || event.key !== "Tab") return;
      const list = focusables(root);
      const first = list[0];
      const last = list[list.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !root.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !root.contains(current))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [active, initialFocus, contain]);

  return ref;
}
