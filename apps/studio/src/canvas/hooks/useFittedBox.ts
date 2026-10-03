import { useEffect, useState, type RefObject } from "react";

export interface Size {
  width: number;
  height: number;
}

interface FittedBoxOptions {
  /** Fit a fixed presentation ratio instead of the image's natural ratio. */
  aspectRatio?: number;
}

/**
 * The largest box with the image's aspect ratio that fits inside `areaRef` (never upscaled
 * past its natural size). A fixed presentation ratio fills the available area instead.
 * Null until both the area and the image's natural size are known.
 */
export function useFittedBox(
  areaRef: RefObject<HTMLElement>,
  natural: Size | null,
  options: FittedBoxOptions = {},
): Size | null {
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
  if (options.aspectRatio) {
    const width = Math.min(area.width, area.height * options.aspectRatio);
    return { width: Math.round(width), height: Math.round(width / options.aspectRatio) };
  }
  const scale = Math.min(area.width / natural.width, area.height / natural.height, 1);
  return { width: Math.round(natural.width * scale), height: Math.round(natural.height * scale) };
}
