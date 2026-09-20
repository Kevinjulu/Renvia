export interface HoleRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 10;
const CARD_GAP = 14;
const VIEW_MARGIN = 16;

export function holeFromRect(rect: DOMRect, pad = PAD): HoleRect {
  return {
    top: rect.top - pad,
    left: rect.left - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function placeCard(hole: HoleRect | null, cardWidth: number, cardHeight: number): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxLeft = Math.max(VIEW_MARGIN, vw - cardWidth - VIEW_MARGIN);
  const maxTop = Math.max(VIEW_MARGIN, vh - cardHeight - VIEW_MARGIN);

  if (!hole) {
    return {
      left: clamp((vw - cardWidth) / 2, VIEW_MARGIN, maxLeft),
      top: clamp((vh - cardHeight) / 2, VIEW_MARGIN, maxTop),
    };
  }

  const right = hole.left + hole.width + CARD_GAP;
  if (right + cardWidth + VIEW_MARGIN <= vw) {
    return { left: right, top: clamp(hole.top, VIEW_MARGIN, maxTop) };
  }

  const left = hole.left - CARD_GAP - cardWidth;
  if (left >= VIEW_MARGIN) {
    return { left, top: clamp(hole.top, VIEW_MARGIN, maxTop) };
  }

  const below = hole.top + hole.height + CARD_GAP;
  if (below + cardHeight + VIEW_MARGIN <= vh) {
    return { left: clamp(hole.left, VIEW_MARGIN, maxLeft), top: below };
  }

  const above = hole.top - CARD_GAP - cardHeight;
  return {
    left: clamp(hole.left, VIEW_MARGIN, maxLeft),
    top: clamp(above, VIEW_MARGIN, maxTop),
  };
}

export function queryGuideTarget(id: string): HTMLElement | null {
  return document.querySelector(`[data-guide="${id}"]`);
}

export function revealGuideTarget(id: string): HTMLElement | null {
  const el = queryGuideTarget(id);
  if (!el) return null;
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
  return el;
}

export function rectsEqual(a: DOMRect | null, b: DOMRect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    Math.round(a.top) === Math.round(b.top) &&
    Math.round(a.left) === Math.round(b.left) &&
    Math.round(a.width) === Math.round(b.width) &&
    Math.round(a.height) === Math.round(b.height)
  );
}
