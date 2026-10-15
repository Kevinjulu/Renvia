import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { BetaAnnotations, BetaFeedbackCategory, BetaFeedbackKind, BetaKnownIssue, BetaSeverity } from "@renvia/types";
import { ApiError, useApiClient } from "../../lib/apiClient";
import { refreshBeta } from "../useBetaStore";
import { AnnotateImage, type AnnotateTool } from "./AnnotationLayer";
import { emptyAnnotations, hasMarks, LIMITS } from "./annotations";
import { useFeedbackStore } from "./useFeedbackStore";

const KINDS: { value: BetaFeedbackKind; label: string }[] = [
  { value: "visual_quality", label: "Render looks wrong" },
  { value: "bug", label: "Something broke" },
  { value: "usability", label: "Hard to use" },
  { value: "suggestion", label: "Idea" },
  { value: "praise", label: "Something great" },
];

export const CATEGORY_LABELS: Record<BetaFeedbackCategory, string> = {
  architecture_changed: "The building's structure changed",
  materials_wrong: "Wrong materials or textures",
  render_failed: "Render failed",
  render_stuck: "Render got stuck",
  edit_wrong: "Edit didn't do what I asked",
  ui_problem: "Studio interface problem",
  billing_credits: "Credits or billing",
  other: "Something else",
};

const SEVERITIES: { value: BetaSeverity; label: string }[] = [
  { value: "low", label: "Minor" },
  { value: "medium", label: "Annoying" },
  { value: "high", label: "Blocks my work" },
  { value: "critical", label: "Lost work or credits" },
];

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

/**
 * "Report a problem": what kind, what went wrong, marks on the render, an optional screenshot.
 * Shows the program's known issues for the chosen category first, so a tester can say "me too"
 * instead of filing the same thing again. Diagnostics are added by the server, not here.
 */
export function FeedbackDrawer() {
  const api = useApiClient();
  const navigate = useNavigate();
  const target = useFeedbackStore((state) => state.target);
  const closeReport = useFeedbackStore((state) => state.closeReport);
  const openThread = useFeedbackStore((state) => state.openThread);

  const [kind, setKind] = useState<BetaFeedbackKind>(target ? "visual_quality" : "bug");
  const [category, setCategory] = useState<BetaFeedbackCategory>(target ? "architecture_changed" : "ui_problem");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<BetaSeverity>("medium");
  const [image, setImage] = useState<BetaAnnotations["image"]>("result");
  const [annotations, setAnnotations] = useState<BetaAnnotations>(emptyAnnotations());
  const [tool, setTool] = useState<AnnotateTool>("pin");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [issues, setIssues] = useState<BetaKnownIssue[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<{ id: string; number: number; note: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.listBetaKnownIssues(category).then(({ issues: found }) => !cancelled && setIssues(found)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, category]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !sending) closeReport();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeReport, sending]);

  const imageUrl = image === "result" ? target?.resultImageUrl ?? target?.sourceImageUrl : target?.sourceImageUrl;
  const markedImage = { ...annotations, image };

  const meToo = async (issue: BetaKnownIssue) => {
    try {
      await api.plusOneBetaIssue(issue.id);
      setIssues((list) => list.map((item) => (item.id === issue.id ? { ...item, mine: true, plusOnes: item.plusOnes + 1 } : item)));
    } catch {
      setError("Couldn't record that. Try again in a moment.");
    }
  };

  const submit = async () => {
    if (!title.trim()) {
      setError("Give your report a short title.");
      return;
    }
    if (screenshot && screenshot.size > MAX_SCREENSHOT_BYTES) {
      setError("That screenshot is over 5 MB. Choose a smaller one or leave it out.");
      return;
    }
    setSending(true);
    setError("");
    try {
      const report = await api.createBetaFeedback({
        kind,
        category,
        title: title.trim(),
        description: description.trim(),
        severity,
        renderId: target?.renderId ?? null,
        projectId: target?.projectId ?? null,
        annotations: target && hasMarks(markedImage) ? markedImage : null,
        appVersion: __APP_VERSION__,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
      });
      let note = "";
      if (screenshot) {
        try {
          await api.attachBetaScreenshot(report.id, screenshot);
        } catch (failure) {
          note = failure instanceof ApiError && failure.detail ? failure.detail : "Your report was sent, but the screenshot couldn't be attached.";
        }
      }
      void refreshBeta(api.getBetaMe);
      setSent({ id: report.id, number: report.number, note });
    } catch (failure) {
      setError(failure instanceof ApiError && failure.detail ? failure.detail : "Couldn't send your report. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  const chip = (active: boolean) => `rounded-full border px-3 py-1 text-xs font-medium ${active ? "border-primary bg-primary text-white" : "border-hairline text-secondary hover:bg-surface-muted"}`;
  const field = "mt-1 w-full rounded-lg border border-hairline px-3 py-2 text-sm text-primary outline-none focus:border-blueprint";

  return (
    <div className="fixed inset-0 z-[55] flex justify-end bg-primary/30" onClick={() => !sending && closeReport()}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-hairline px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blueprint">Beta feedback</p>
            <h2 id="feedback-title" className="font-display text-lg font-semibold text-primary">{target ? "Report this render" : "Report a problem"}</h2>
          </div>
          <button type="button" onClick={closeReport} disabled={sending} className="rounded-lg px-2.5 py-1.5 text-sm text-secondary hover:bg-surface-muted" aria-label="Close">
            ✕
          </button>
        </header>

        {sent ? (
          <div className="flex-1 space-y-3 px-5 py-6">
            <h3 className="font-display text-xl font-semibold text-primary">Thank you — BETA-{sent.number} is with the team</h3>
            <p className="text-sm text-muted">We'll reply in your Beta Program area. You can follow it there and answer any questions we have.</p>
            {sent.note && <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-800">{sent.note}</p>}
            <div className="flex gap-2.5 pt-2">
              <button type="button" onClick={closeReport} className="rounded-lg px-3.5 py-2 text-sm font-medium text-secondary hover:bg-surface-muted">Back to work</button>
              <button type="button" onClick={() => { closeReport(); openThread(sent.id); navigate("/beta"); }} className="rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-white hover:opacity-90">Follow this report</button>
            </div>
          </div>
        ) : (
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
            <section>
              <p className="text-sm font-medium text-primary">What's this about?</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {KINDS.map((option) => (
                  <button key={option.value} type="button" className={chip(kind === option.value)} onClick={() => setKind(option.value)}>{option.label}</button>
                ))}
              </div>
            </section>

            <label className="block text-sm font-medium text-primary">
              What went wrong?
              <select className={field} value={category} onChange={(event) => setCategory(event.target.value as BetaFeedbackCategory)}>
                {(Object.keys(CATEGORY_LABELS) as BetaFeedbackCategory[]).map((value) => <option key={value} value={value}>{CATEGORY_LABELS[value]}</option>)}
              </select>
            </label>

            {issues.length > 0 && (
              <section className="rounded-xl border border-blueprint/30 bg-blueprint-soft px-4 py-3">
                <p className="text-sm font-medium text-primary">Known issues like this</p>
                <p className="text-xs text-secondary">If one of these is your problem, tell us instead of reporting it again.</p>
                <ul className="mt-2 space-y-1.5">
                  {issues.map((issue) => (
                    <li key={issue.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 text-primary">{issue.title} <span className="text-xs text-faint">· {issue.plusOnes + 1} affected</span></span>
                      {issue.mine ? (
                        <span className="shrink-0 text-xs text-emerald-700">Counted</span>
                      ) : (
                        <button type="button" onClick={() => void meToo(issue)} className="shrink-0 rounded-lg border border-hairline bg-white px-2.5 py-1 text-xs font-medium text-secondary hover:bg-surface-muted">I have this too</button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {target && imageUrl && (
              <section>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-primary">Mark the problem</p>
                  <div className="flex gap-1.5">
                    {(["pin", "box", "draw"] as AnnotateTool[]).map((option) => (
                      <button key={option} type="button" className={chip(tool === option)} onClick={() => setTool(option)}>{option === "pin" ? "Pin" : option === "box" ? "Box" : "Draw"}</button>
                    ))}
                    <button type="button" className={chip(false)} onClick={() => setAnnotations(emptyAnnotations(image))} disabled={!hasMarks(annotations)}>Clear</button>
                  </div>
                </div>
                {target.resultImageUrl && target.sourceImageUrl && (
                  <div className="mt-2 flex gap-1.5">
                    <button type="button" className={chip(image === "result")} onClick={() => { setImage("result"); setAnnotations(emptyAnnotations("result")); }}>Render</button>
                    <button type="button" className={chip(image === "source")} onClick={() => { setImage("source"); setAnnotations(emptyAnnotations("source")); }}>Your upload</button>
                  </div>
                )}
                <div className="mt-2">
                  <AnnotateImage src={imageUrl} annotations={markedImage} tool={tool} onChange={setAnnotations} />
                </div>
                <p className="mt-1 text-xs text-faint">
                  Click to pin (up to {LIMITS.pins}), drag a box, or draw around it. Marks stay on the exact spot whatever size the team views it at.
                </p>
              </section>
            )}

            <label className="block text-sm font-medium text-primary">
              Short title
              <input className={field} value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. The roof pitch changed on the front elevation" />
            </label>
            <label className="block text-sm font-medium text-primary">
              What happened?
              <textarea className={`${field} min-h-[96px]`} value={description} maxLength={4000} onChange={(event) => setDescription(event.target.value)} placeholder="What you did, what you expected, and what you got instead." />
            </label>

            <section>
              <p className="text-sm font-medium text-primary">How much does it get in the way?</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {SEVERITIES.map((option) => (
                  <button key={option.value} type="button" className={chip(severity === option.value)} onClick={() => setSeverity(option.value)}>{option.label}</button>
                ))}
              </div>
            </section>

            <label className="block text-sm font-medium text-primary">
              Screenshot <span className="font-normal text-faint">(optional, up to 5 MB)</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" className="mt-1 block w-full text-sm text-secondary" onChange={(event) => setScreenshot(event.target.files?.[0] ?? null)} />
            </label>

            <p className="text-xs text-faint">
              We attach technical details of the render you're reporting (model, timings, any error) from our own records. We don't record your screen or what you clicked.
            </p>
            {error && <p className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700" role="alert">{error}</p>}
          </div>
        )}

        {!sent && (
          <footer className="flex justify-end gap-2.5 border-t border-hairline px-5 py-4">
            <button type="button" onClick={closeReport} disabled={sending} className="rounded-lg px-3.5 py-2 text-sm font-medium text-secondary hover:bg-surface-muted">Cancel</button>
            <button type="button" onClick={() => void submit()} disabled={sending} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">
              {sending ? "Sending…" : "Send report"}
            </button>
          </footer>
        )}
      </aside>
    </div>
  );
}
