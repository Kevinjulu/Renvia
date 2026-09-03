interface RenderTabBodyProps {
  prompt: string;
  onPromptChange: (value: string) => void;
}

export function RenderTabBody({ prompt, onPromptChange }: RenderTabBodyProps) {
  return (
    <div className="flex flex-1 flex-col">
      <textarea
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        placeholder="Example: A modern house with a wood cladding located by the Swedish coast and surrounding pine trees"
        className="min-h-[140px] flex-1 resize-none rounded-lg border border-hairline p-3 text-sm text-primary placeholder:text-faint focus:border-blueprint focus:outline-none"
      />
      <div className="mt-2 flex gap-3 text-faint">
        <button type="button" disabled title="Add reference image (coming soon)" className="cursor-not-allowed">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="2" y="3" width="12" height="10" rx="1.3" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="6" cy="7" r="1" stroke="currentColor" strokeWidth="1" />
            <path d="M2.5 11.5 6 8.5l2.5 2.5 2-2 3 3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M10.5 2.5h3v3M13.5 2.5 11 5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          </svg>
        </button>
        <button type="button" disabled title="Browse material library (coming soon)" className="cursor-not-allowed">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 2.5h6l2 2v9H4Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            <path d="M6.5 6h3M6.5 8.5h3M6.5 11h2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
