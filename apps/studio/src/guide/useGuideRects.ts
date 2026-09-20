import { useLayoutEffect, useState } from "react";
import { queryGuideTarget, rectsEqual } from "./geometry";

function snapshot(ids: readonly string[]): Map<string, DOMRect> {
  const next = new Map<string, DOMRect>();
  for (const id of ids) {
    const el = queryGuideTarget(id);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    next.set(id, rect);
  }
  return next;
}

function sameMaps(a: Map<string, DOMRect>, b: Map<string, DOMRect>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, rect] of a) {
    const other = b.get(id) ?? null;
    if (!rectsEqual(rect, other)) return false;
  }
  return true;
}

export function useGuideRects(ids: readonly string[], enabled: boolean): Map<string, DOMRect> {
  const [rects, setRects] = useState<Map<string, DOMRect>>(() => new Map());

  useLayoutEffect(() => {
    if (!enabled) {
      setRects(new Map());
      return;
    }

    const update = () => {
      const next = snapshot(ids);
      setRects((prev) => (sameMaps(prev, next) ? prev : next));
    };

    update();

    const observers: ResizeObserver[] = [];
    const ro = new ResizeObserver(update);
    ro.observe(document.documentElement);
    observers.push(ro);
    for (const id of ids) {
      const el = queryGuideTarget(id);
      if (!el) continue;
      const local = new ResizeObserver(update);
      local.observe(el);
      observers.push(local);
    }

    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);

    const mo = new MutationObserver(update);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-guide"] });

    return () => {
      observers.forEach((observer) => observer.disconnect());
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      mo.disconnect();
    };
  }, [enabled, ids.join("|")]);

  return rects;
}
