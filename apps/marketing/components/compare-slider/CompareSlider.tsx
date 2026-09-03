"use client";

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

interface CompareSliderProps {
  before: ReactNode;
  after: ReactNode;
  beforeLabel?: string;
  afterLabel?: string;
  cornerLabel?: string;
  initialPosition?: number;
  className?: string;
  /** Fill the parent's box instead of imposing an aspect ratio and default card chrome — for embedding inside a container that already provides sizing and borders. */
  fill?: boolean;
}

export function CompareSlider({
  before,
  after,
  beforeLabel = "Before",
  afterLabel = "After",
  cornerLabel,
  initialPosition = 50,
  className = "",
  fill = false,
}: CompareSliderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(initialPosition);
  const [dragging, setDragging] = useState(false);

  const updateFromClientX = useCallback((clientX: number) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const percent = ((clientX - rect.left) / rect.width) * 100;
    setPosition(Math.min(100, Math.max(0, percent)));
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    updateFromClientX(event.clientX);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragging) return;
    updateFromClientX(event.clientX);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowLeft") {
      setPosition((p) => Math.max(0, p - 4));
    } else if (event.key === "ArrowRight") {
      setPosition((p) => Math.min(100, p + 4));
    } else if (event.key === "Home") {
      setPosition(0);
    } else if (event.key === "End") {
      setPosition(100);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`relative touch-none select-none overflow-hidden ${
        fill ? "h-full w-full" : "aspect-[4/3] w-full rounded-2xl border border-hairline bg-surface sm:aspect-video"
      } ${className}`}
    >
      <div className="absolute inset-0">{after}</div>
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
      >
        {before}
      </div>

      <span className="pointer-events-none absolute left-3 top-3 rounded-md bg-white/90 px-3 py-1.5 text-xs font-medium text-primary shadow-sm backdrop-blur-sm">
        {beforeLabel}
      </span>
      <span className="pointer-events-none absolute right-3 top-3 rounded-md bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm">
        {afterLabel}
      </span>
      {cornerLabel && (
        <span className="pointer-events-none absolute bottom-3 right-3 rounded-md bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm">
          {cornerLabel}
        </span>
      )}

      <div
        className="pointer-events-none absolute inset-y-0 w-0.5 bg-white/80"
        style={{ left: `${position}%` }}
      />

      <button
        type="button"
        role="slider"
        aria-label="Drag to compare before and after"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(position)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={handleKeyDown}
        className="absolute top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full bg-white text-primary shadow-[0_2px_12px_rgba(20,20,20,0.25)] outline-none focus-visible:ring-2 focus-visible:ring-blueprint"
        style={{ left: `${position}%` }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M5 3 L1.5 8 L5 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M11 3 L14.5 8 L11 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
