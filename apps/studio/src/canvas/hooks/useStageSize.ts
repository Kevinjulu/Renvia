import { useEffect, useRef, useState } from "react";
import { DEFAULT_STAGE_HEIGHT, DEFAULT_STAGE_WIDTH } from "../constants";

export function useStageSize() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: DEFAULT_STAGE_WIDTH, height: DEFAULT_STAGE_HEIGHT });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width: Math.max(1, width), height: Math.max(1, height) });
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return { containerRef, size };
}
