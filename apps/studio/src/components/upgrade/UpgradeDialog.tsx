import { useEffect, useRef } from "react";
import type { MeResponse } from "@renvia/types";
import { PLAN_FOR_TOPIC, useUpgradeDialogStore, type UpgradeTopic } from "../../lib/useUpgradeDialog";
import { useAccountStore } from "../../lib/useAccountStore";

interface Copy {
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
}

/** What the user tried, why their plan stops it, and what the plan that unlocks it adds. */
function copyFor(topic: UpgradeTopic, me: MeResponse | null): Copy {
  const onPro = me?.entitlement.plan.slug === "studio";
  switch (topic) {
    case "download":
      return {
        eyebrow: "Free plan",
        title: "Downloads come with a paid plan",
        body: "On the free plan you can render, edit and compare as much as your credits allow, but renders stay in the Studio. A paid plan lets you download and copy them as clean, watermark-free files.",
        points: ["JPG, PNG or WebP, at full resolution", "Before & after layouts for client reviews", "Every render you've already made, not just new ones"],
      };
    case "export.4k":
      return {
        eyebrow: "Pro feature",
        title: "4K output comes with Pro",
        body: "The free plan delivers renders at the model's own size. Pro AI-upscales them to 3,840 px, ready to present or print.",
        points: ["Render straight to 4K, or upscale a finished render", "Clean, watermark-free downloads", "More credits every month"],
      };
    case "export.8k":
      return onPro
        ? {
            eyebrow: "Premium feature",
            title: "8K output comes with Premium",
            body: "Your Pro plan includes 4K. Premium adds 8K (7,680 px) for large-format prints and close crops.",
            points: ["Render straight to 8K, or upscale a finished render", "More credits and more renders at once", "Everything in Pro"],
          }
        : {
            eyebrow: "Premium feature",
            title: "8K output comes with Premium",
            body: "The free plan delivers renders at the model's own size. Premium AI-upscales them to 4K or 8K (7,680 px) for large-format prints and close crops.",
            points: ["4K and 8K output, or upscale a finished render", "Clean, watermark-free downloads", "The most credits and renders at once"],
          };
  }
}

/** Explains a plan-locked action, then offers the plans in a popup without leaving the Studio. */
export function UpgradeDialog() {
  const topic = useUpgradeDialogStore((state) => state.topic);
  const dismiss = useUpgradeDialogStore((state) => state.dismiss);
  const openPlans = useUpgradeDialogStore((state) => state.openPlans);
  const me = useAccountStore((state) => state.me);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!topic) return;
    primaryRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [topic, dismiss]);

  if (!topic) return null;
  const copy = copyFor(topic, me);

  return (
    <div className="upgrade-backdrop" onMouseDown={(event) => event.target === event.currentTarget && dismiss()}>
      <div className="upgrade-dialog" role="alertdialog" aria-modal="true" aria-labelledby="upgrade-title" aria-describedby="upgrade-body">
        <span className="upgrade-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16">
            <rect x="3" y="7" width="10" height="7" rx="1.5" />
            <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
          </svg>
        </span>
        <p className="upgrade-eyebrow">{copy.eyebrow}</p>
        <h2 id="upgrade-title">{copy.title}</h2>
        <p id="upgrade-body" className="upgrade-body">{copy.body}</p>
        <ul className="upgrade-points">
          {copy.points.map((point) => (
            <li key={point}>
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <path d="m2.5 6.2 2.3 2.3 4.7-5" />
              </svg>
              {point}
            </li>
          ))}
        </ul>
        <footer>
          <button type="button" className="upgrade-secondary" onClick={dismiss}>
            Not now
          </button>
          <button ref={primaryRef} type="button" className="upgrade-primary" onClick={() => openPlans({ highlight: PLAN_FOR_TOPIC[topic] })}>
            See plans
          </button>
        </footer>
      </div>
    </div>
  );
}
