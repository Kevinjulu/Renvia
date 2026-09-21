import { useId, useState, type ReactNode } from "react";

const STORAGE_KEY = "renvia.panel.advancedOpen";

function readOpen() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Fine-tuning controls, folded away until asked for. Open/closed is remembered per browser. */
export function AdvancedSection({ summary, children }: { summary: string; children: ReactNode }) {
  const [open, setOpen] = useState(readOpen);
  const contentId = useId();

  const toggle = () => {
    setOpen((current) => {
      try {
        localStorage.setItem(STORAGE_KEY, current ? "0" : "1");
      } catch {
        // Storage can be blocked; the section still works, it just won't remember.
      }
      return !current;
    });
  };

  return (
    <section className={`cp-advanced ${open ? "is-open" : ""}`}>
      <button type="button" className="cp-advanced-toggle" onClick={toggle} aria-expanded={open} aria-controls={contentId}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 4.5h10M3 8h10M3 11.5h10" />
          <circle cx="6" cy="4.5" r="1.4" />
          <circle cx="10.5" cy="8" r="1.4" />
          <circle cx="5" cy="11.5" r="1.4" />
        </svg>
        <span>
          <strong>Advanced settings</strong>
          <small>{summary}</small>
        </span>
        <svg className="cp-caret" width="11" height="11" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M2 3.5 5 6.5l3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div id={contentId} className="cp-advanced-content">
          {children}
        </div>
      )}
    </section>
  );
}
