import { useEffect, useRef, useState } from "react";
import type { BetaFeedbackKind } from "@renvia/types";
import { useRenderJobsStore } from "../../canvas/hooks/useRenderJobsStore";
import { useBetaStore } from "../useBetaStore";
import { KINDS, reportableRenders } from "./presets";
import { useFeedbackStore } from "./useFeedbackStore";

function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
}

/**
 * The tester's Feedback button in the Studio header: always in sight, so reporting never means
 * hunting through a menu. Offers the render on screen first, then each kind of feedback.
 * Shift+F opens it from anywhere in the Studio. Renders nothing for non-testers.
 */
export function FeedbackButton() {
  const isTester = useBetaStore((state) => state.tester !== null);
  const openReport = useFeedbackStore((state) => state.openReport);
  const reportOpen = useFeedbackStore((state) => state.open);
  const current = useRenderJobsStore((state) => {
    const id = state.previewJobId ?? state.activeJobId;
    const job = state.jobs.find((item) => item.id === id);
    return job && reportableRenders([job]).length > 0 ? job : null;
  });
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isTester) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "f" && !isTyping(event.target) && !useFeedbackStore.getState().open) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isTester]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [open]);

  if (!isTester) return null;

  const start = (kind: BetaFeedbackKind | null, withRender = false) => {
    setOpen(false);
    openReport(
      withRender && current ? { renderId: current.id, projectId: current.projectId, resultImageUrl: current.resultImageUrl ?? null, sourceImageUrl: current.sourceImageUrl ?? null } : null,
      kind,
    );
  };
  const thumb = current?.resultImageUrl ?? current?.sourceImageUrl;

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        data-guide="beta.feedback"
        aria-haspopup="menu"
        aria-expanded={open || reportOpen}
        title="Send feedback (Shift+F)"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-[34px] items-center gap-1.5 rounded-[9px] border border-hairline bg-white px-2.5 text-xs font-semibold text-primary hover:bg-surface-muted"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
          <path d="M5.5 6.5h5M5.5 8.5h3" />
        </svg>
        Feedback
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-2 w-80 rounded-xl border border-hairline bg-white p-2 shadow-xl">
          <p className="px-3 pb-1.5 pt-1 text-xs font-semibold uppercase tracking-wide text-blueprint">Beta feedback</p>
          {current && thumb && (
            <button type="button" role="menuitem" onClick={() => start("visual_quality", true)} className="mb-1 flex w-full items-center gap-3 rounded-lg border border-blueprint/30 bg-blueprint-soft px-2.5 py-2 text-left hover:border-blueprint/60">
              <img src={thumb} alt="" className="h-10 w-14 shrink-0 rounded-md object-cover" />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-primary">Report the render on screen</span>
                <span className="block text-xs text-secondary">Mark exactly where it went wrong</span>
              </span>
            </button>
          )}
          {KINDS.map((kind) => (
            <button key={kind.value} type="button" role="menuitem" onClick={() => start(kind.value)} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-surface-muted">
              <span className="block text-sm font-medium text-primary">{kind.label}</span>
              <span className="block text-xs text-muted">{kind.hint}</span>
            </button>
          ))}
          <p className="mt-1 border-t border-hairline px-3 pt-2 text-[11px] text-faint">
            Tip: press <kbd className="rounded border border-hairline px-1 font-sans">Shift</kbd> + <kbd className="rounded border border-hairline px-1 font-sans">F</kbd> anywhere in the Studio.
          </p>
        </div>
      )}
    </div>
  );
}
