import { useEffect, useState, type RefObject } from "react";

export interface Size {
  width: number;
  height: number;
}

/**
 * The largest box with the image's aspect ratio that fits inside `areaRef` (never upscaled
 * past its natural size). Null until both the area and the image's natural size are known.
 */
export function useFittedBox(areaRef: RefObject<HTMLElement>, natural: Size | null): Size | null {
  const [area, setArea] = useState<Size | null>(null);

  useEffect(() => {
    const element = areaRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setArea({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [areaRef]);

  if (!natural || !area || area.width <= 0 || area.height <= 0) return null;
  const scale = Math.min(area.width / natural.width, area.height / natural.height, 1);
  return { width: Math.round(natural.width * scale), height: Math.round(natural.height * scale) };
}
