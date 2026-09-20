import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { getGuideTopic, type GuideTopicId } from "./catalog";
import { clamp } from "./geometry";
import { useGuideStore } from "./useGuideStore";

interface HelpHotspotProps {
  topicId: GuideTopicId;
  label?: string;
}

export function HelpHotspot({ topicId, label }: HelpHotspotProps) {
  const topic = getGuideTopic(topicId);
  const openId = useGuideStore((state) => state.hotspotId);
  const mode = useGuideStore((state) => state.mode);
  const openHotspot = useGuideStore((state) => state.openHotspot);
  const open = openId === topicId && mode !== "tour";
  const buttonRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const titleId = useId();

  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const width = 300;
    const left = clamp(rect.left, 12, window.innerWidth - width - 12);
    const estimated = 170;
    const below = rect.bottom + 8;
    const top = below + estimated > window.innerHeight - 12 ? Math.max(12, rect.top - estimated - 8) : below;
    setPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || cardRef.current?.contains(target)) return;
      openHotspot(null);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open, openHotspot]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`guide-hotspot ${open ? "is-open" : ""}`}
        aria-expanded={open}
        aria-controls={open ? titleId : undefined}
        aria-label={label ?? `About ${topic.title}`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openHotspot(open ? null : topicId);
        }}
      >
        ?
      </button>
      {open &&
        createPortal(
          <div ref={cardRef} className="guide-hotspot-card" style={{ top: pos.top, left: pos.left }} role="dialog" aria-labelledby={titleId}>
            <p id={titleId} className="guide-card-kicker">
              {topic.title}
            </p>
            <p className="guide-card-body">{topic.body}</p>
            <p className="guide-card-how">{topic.how}</p>
          </div>,
          document.body,
        )}
    </>
  );
}

export function GuideLabel({ children, topicId }: { children: ReactNode; topicId: GuideTopicId }) {
  return (
    <span className="guide-label">
      {children}
      <HelpHotspot topicId={topicId} />
    </span>
  );
}
