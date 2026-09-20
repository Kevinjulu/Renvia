import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGuideStore } from "./useGuideStore";

export function GuideButton() {
  const mode = useGuideStore((state) => state.mode);
  const stepIndex = useGuideStore((state) => state.stepIndex);
  const startTour = useGuideStore((state) => state.startTour);
  const skipTour = useGuideStore((state) => state.skipTour);
  const toggleLegend = useGuideStore((state) => state.toggleLegend);
  const closeLegend = useGuideStore((state) => state.closeLegend);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const touring = mode === "tour";
  const inspecting = mode === "legend";

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  useEffect(() => {
    if (touring || inspecting) setOpen(false);
  }, [touring, inspecting]);

  return (
    <div ref={rootRef} className="guide-menu">
      <button
        type="button"
        className={`guide-trigger ${inspecting ? "is-active" : ""} ${touring ? "is-touring" : ""}`}
        aria-label={touring ? "Studio tour in progress" : inspecting ? "Close layout guide" : "Studio guide"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title="Studio guide"
        onClick={() => {
          if (inspecting) {
            closeLegend();
            return;
          }
          if (touring) {
            skipTour();
            return;
          }
          setOpen((value) => !value);
        }}
      >
        {touring ? (
          <span className="guide-trigger-progress">{stepIndex + 1}</span>
        ) : (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="6.2" />
            <path d="M6.35 6.2a1.7 1.7 0 0 1 3.35.7c0 1.15-1.6 1.5-1.6 2.55" />
            <circle cx="8" cy="11.35" r="0.65" fill="currentColor" stroke="none" />
          </svg>
        )}
      </button>

      {open && (
        <div id={menuId} role="menu" aria-label="Studio guide" className="guide-popover">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              startTour("orientation");
            }}
          >
            Take the studio tour
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              toggleLegend();
            }}
          >
            Inspect the layout
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate("/help/getting-started");
            }}
          >
            Help center
          </button>
        </div>
      )}
    </div>
  );
}
