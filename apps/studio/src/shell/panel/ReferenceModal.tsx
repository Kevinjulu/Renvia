import type { ReactNode } from "react";

/** The popup shell the reference pickers share: backdrop, title bar and a scrolling body. */
export function ReferenceModal({
  title,
  titleId,
  children,
  onClose,
  wide,
}: {
  title: string;
  titleId: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="reference-modal-backdrop" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`reference-modal ${wide ? "is-wide" : ""}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="reference-modal-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="reference-modal-close">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="m2 2 8 8M10 2 2 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="reference-modal-body">{children}</div>
      </div>
    </div>
  );
}
