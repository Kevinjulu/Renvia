import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useCanvasStore } from "../canvas/hooks/useCanvasStore";
import {
  DONE_COPY,
  getGuideTopic,
  LEGEND_TOPICS,
  ORIENTATION_TOUR,
  WELCOME_COPY,
  type GuideTopicId,
} from "./catalog";
import { holeFromRect, placeCard, revealGuideTarget } from "./geometry";
import { useGuideRects } from "./useGuideRects";
import { useGuideStore } from "./useGuideStore";

const CARD_WIDTH = 336;
const CARD_HEIGHT = 248;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function GuideLayer() {
  const mode = useGuideStore((state) => state.mode);
  const stepIndex = useGuideStore((state) => state.stepIndex);
  const inspectId = useGuideStore((state) => state.inspectId);
  if (mode === "idle") return null;
  return (
    <GuideLayerActive mode={mode} stepIndex={stepIndex} inspectId={inspectId} />
  );
}

function GuideLayerActive({
  mode,
  stepIndex,
  inspectId,
}: {
  mode: "tour" | "legend";
  stepIndex: number;
  inspectId: GuideTopicId | null;
}) {
  const step = mode === "tour" ? ORIENTATION_TOUR.steps[stepIndex] ?? null : null;
  const spotId = step?.kind === "spot" ? step.topicId : mode === "legend" ? inspectId : null;
  const legendIds = useMemo(() => LEGEND_TOPICS.map((topic) => topic.id), []);
  const measureIds = mode === "tour" ? (spotId ? [spotId] : []) : legendIds;
  const rects = useGuideRects(measureIds, true);
  const holeRect = spotId ? rects.get(spotId) ?? null : null;
  const hole = holeRect ? holeFromRect(holeRect) : null;
  const dim = mode === "tour";

  useEffect(() => {
    if (spotId) revealGuideTarget(spotId);
  }, [spotId, stepIndex, mode]);

  return createPortal(
    <div className={`guide-layer ${mode === "legend" ? "is-legend" : ""}`} role="presentation">
      {dim ? <TourMask hole={hole} /> : <LegendOutlines rects={rects} activeId={inspectId} />}
      {mode === "tour" && <TourCard stepIndex={stepIndex} hole={hole} />}
      {mode === "legend" && <LegendPins rects={rects} activeId={inspectId} />}
      {mode === "legend" && <LegendInspector activeId={inspectId} />}
    </div>,
    document.body,
  );
}

function TourMask({ hole }: { hole: ReturnType<typeof holeFromRect> | null }) {
  if (!hole) {
    return <div className="guide-scrim" />;
  }
  const { top, left, width, height } = hole;
  return (
    <>
      <div className="guide-scrim-slice" style={{ top: 0, left: 0, right: 0, height: Math.max(0, top) }} />
      <div className="guide-scrim-slice" style={{ top, left: 0, width: Math.max(0, left), height }} />
      <div className="guide-scrim-slice" style={{ top, left: left + width, right: 0, height }} />
      <div className="guide-scrim-slice" style={{ top: top + height, left: 0, right: 0, bottom: 0 }} />
      <div className="guide-hole-catch" style={{ top, left, width, height }} />
      <div className="guide-hole-ring" style={{ top, left, width, height }} />
    </>
  );
}

function LegendOutlines({ rects, activeId }: { rects: Map<string, DOMRect>; activeId: GuideTopicId | null }) {
  const active = activeId ? rects.get(activeId) : null;
  if (!active) return null;
  const hole = holeFromRect(active, 6);
  return <div className="guide-legend-ring" style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }} />;
}

function TourCard({ stepIndex, hole }: { stepIndex: number; hole: ReturnType<typeof holeFromRect> | null }) {
  const steps = ORIENTATION_TOUR.steps;
  const step = steps[stepIndex];
  const nextStep = useGuideStore((state) => state.nextStep);
  const prevStep = useGuideStore((state) => state.prevStep);
  const skipTour = useGuideStore((state) => state.skipTour);
  const cardRef = useRef<HTMLDivElement>(null);
  const pos = placeCard(step?.kind === "welcome" || step?.kind === "done" ? null : hole, CARD_WIDTH, CARD_HEIGHT);

  useEffect(() => {
    cardRef.current?.focus();
  }, [stepIndex]);

  if (!step) return null;

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;
  const topic = step.kind === "spot" ? getGuideTopic(step.topicId) : null;
  const title = topic?.title ?? (step.kind === "done" ? DONE_COPY.title : WELCOME_COPY.title);
  const body = topic?.body ?? (step.kind === "done" ? DONE_COPY.body : WELCOME_COPY.body);
  const how = topic?.how ?? null;

  return (
    <div
      ref={cardRef}
      className={`guide-card ${step.kind !== "spot" ? "is-center" : ""}`}
      style={{ top: pos.top, left: pos.left, width: CARD_WIDTH }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="studio-guide-title"
      tabIndex={-1}
    >
      <div className="guide-card-top">
        <span>
          {isFirst ? "Studio tour" : isLast ? "Done" : `${stepIndex} / ${steps.length - 2}`}
        </span>
        <button type="button" className="guide-text-btn" onClick={skipTour}>
          Skip
        </button>
      </div>
      <h2 id="studio-guide-title">{title}</h2>
      <p className="guide-card-body">{body}</p>
      {how && <p className="guide-card-how">{how}</p>}
      <div className="guide-card-actions">
        {!isFirst && (
          <button type="button" className="guide-btn-secondary" onClick={prevStep}>
            Back
          </button>
        )}
        <button type="button" className="guide-btn-primary" onClick={nextStep}>
          {isFirst ? "Start" : isLast ? "Finish" : "Next"}
        </button>
      </div>
    </div>
  );
}

function LegendPins({ rects, activeId }: { rects: Map<string, DOMRect>; activeId: GuideTopicId | null }) {
  const inspect = useGuideStore((state) => state.inspect);
  const setActiveTab = useCanvasStore((state) => state.setActiveTab);

  return (
    <>
      {LEGEND_TOPICS.map((topic) => {
        const rect = rects.get(topic.id);
        if (!rect || topic.legend == null) return null;
        const top = Math.max(8, rect.top - 8);
        const left = Math.max(8, rect.left - 8);
        const active = activeId === topic.id;
        return (
          <button
            key={topic.id}
            type="button"
            className={`guide-pin ${active ? "is-active" : ""}`}
            style={{ top, left }}
            aria-label={`${pad(topic.legend)} ${topic.title}`}
            aria-pressed={active}
            onClick={() => {
              if (topic.tab) setActiveTab(topic.tab);
              inspect(topic.id);
            }}
          >
            {pad(topic.legend)}
          </button>
        );
      })}
    </>
  );
}

function LegendInspector({ activeId }: { activeId: GuideTopicId | null }) {
  const inspect = useGuideStore((state) => state.inspect);
  const closeLegend = useGuideStore((state) => state.closeLegend);
  const startTour = useGuideStore((state) => state.startTour);
  const setActiveTab = useCanvasStore((state) => state.setActiveTab);
  const navigate = useNavigate();
  const topic = activeId ? getGuideTopic(activeId) : null;

  return (
    <aside className="guide-inspector" aria-label="Layout guide">
      <div className="guide-inspector-head">
        <div>
          <p className="guide-card-kicker">Layout guide</p>
          <strong>What each region is</strong>
        </div>
        <button type="button" className="guide-icon-close" aria-label="Close layout guide" onClick={closeLegend}>
          <svg viewBox="0 0 14 14" aria-hidden="true">
            <path d="M3 3l8 8M11 3l-8 8" />
          </svg>
        </button>
      </div>

      <ol className="guide-inspector-list">
        {LEGEND_TOPICS.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={item.id === activeId ? "is-active" : ""}
              onClick={() => {
                if (item.tab) setActiveTab(item.tab);
                inspect(item.id);
                revealGuideTarget(item.id);
              }}
            >
              <i>{pad(item.legend ?? 0)}</i>
              <span>
                <b>{item.title}</b>
                {item.short}
              </span>
            </button>
          </li>
        ))}
      </ol>

      {topic && (
        <div className="guide-inspector-detail">
          <h3>{topic.title}</h3>
          <p>{topic.body}</p>
          <p className="guide-card-how">{topic.how}</p>
          <div className="guide-inspector-links">
            {topic.article && (
              <button type="button" className="guide-text-btn" onClick={() => navigate(`/help/${topic.article}`)}>
                Learn more
              </button>
            )}
            <button type="button" className="guide-text-btn" onClick={() => startTour("orientation")}>
              Replay tour
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
