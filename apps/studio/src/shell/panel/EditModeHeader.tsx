export function EditModeHeader() {
  return (
    <div className="flex flex-col items-center px-2 pt-1 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-muted text-secondary">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path
            d="M11.5 2.5 15 6l-8 8-4 1 1-4Z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <h2 className="mt-3 font-display text-base font-semibold text-primary">Editing mode</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">
        Describe the changes you would like to see. To edit a specific part, use the selection tool at the bottom of
        the canvas to highlight that area.
      </p>
    </div>
  );
}
