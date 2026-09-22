import { useCallback, useEffect, useRef, useState, type RefObject, type WheelEvent as ReactWheelEvent } from "react";

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 1.12;

export interface WheelZoomResult<T extends HTMLElement> {
  /** 1 = fit (no zoom). */
  zoom: number;
  /** CSS transform-origin, kept under the cursor as it changes so zoom feels anchored there. */
  transformOrigin: string;
  /** The element being scaled — its rendered size anchors each zoom step. */
  targetRef: RefObject<T>;
  onWheel: (event: ReactWheelEvent) => void;
  resetZoom: () => void;
  isZoomed: boolean;
}

/**
 * Scroll/trackpad-driven zoom for an image viewer: the point under the cursor stays fixed as
 * the scale changes, by moving transform-origin there before each step. `resetKey` changing
 * (a new image, leaving the viewer, …) snaps the zoom back to fit.
 */
export function useWheelZoom<T extends HTMLElement = HTMLDivElement>(resetKey: unknown): WheelZoomResult<T> {
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [transformOrigin, setTransformOrigin] = useState("50% 50%");
  const targetRef = useRef<T>(null);

  const resetZoom = useCallback(() => {
    setZoom(MIN_ZOOM);
    setTransformOrigin("50% 50%");
  }, []);

  useEffect(resetZoom, [resetKey, resetZoom]);

  const onWheel = useCallback((event: ReactWheelEvent) => {
    const target = targetRef.current;
    if (!target) return;
    event.preventDefault();
    const rect = target.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const originX = Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100));
    const originY = Math.min(100, Math.max(0, ((event.clientY - rect.top) / rect.height) * 100));
    setTransformOrigin(`${originX}% ${originY}%`);
    setZoom((current) => {
      const direction = event.deltaY > 0 ? -1 : 1;
      const next = direction > 0 ? current / ZOOM_STEP : current * ZOOM_STEP;
      return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    });
  }, []);

  return { zoom, transformOrigin, targetRef, onWheel, resetZoom, isZoomed: zoom > MIN_ZOOM + 0.001 };
}
