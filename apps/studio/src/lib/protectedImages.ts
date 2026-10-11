import { useEffect } from "react";

/**
 * Rendered images are meant to leave the Studio through its download flow. Inside an element
 * marked with this attribute, an <img> or <canvas> gets no right-click menu ("Save image as",
 * "Copy image") and can't be dragged out to the desktop or another tab.
 *
 * A deterrent only: anything shown in a browser can still be captured. What actually protects
 * renders is the server only ever sending free-plan users the watermarked copy.
 */
export const PROTECTED_IMAGES = { "data-protected-images": "" } as const;

function isProtectedImage(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  // Only the pictures themselves: text fields and buttons in the same area keep their menu.
  if (target.tagName !== "IMG" && target.tagName !== "CANVAS") return false;
  return target.closest("[data-protected-images]") !== null;
}

/** Installs the right-click and drag guard for PROTECTED_IMAGES areas. Mount once per page. */
export function useProtectedImages(): void {
  useEffect(() => {
    const guard = (event: Event) => {
      if (isProtectedImage(event.target)) event.preventDefault();
    };
    // Native drag only: canvas panning, node moves and the compare slider use pointer events.
    document.addEventListener("contextmenu", guard);
    document.addEventListener("dragstart", guard);
    return () => {
      document.removeEventListener("contextmenu", guard);
      document.removeEventListener("dragstart", guard);
    };
  }, []);
}
