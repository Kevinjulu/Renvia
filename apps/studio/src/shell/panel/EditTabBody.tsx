import { useState } from "react";

type EditAction = "add" | "remove" | "change";

const ACTIONS: { id: EditAction; label: string; hasMenu?: boolean }[] = [
  { id: "add", label: "Add" },
  { id: "remove", label: "Remove" },
  { id: "change", label: "Change", hasMenu: true },
];

interface EditTabBodyProps {
  currentImageUrl: string | null;
}

export function EditTabBody({ currentImageUrl }: EditTabBodyProps) {
  const [activeAction, setActiveAction] = useState<EditAction | null>(null);
  const [imageRemoved, setImageRemoved] = useState(false);
  const [editPrompt, setEditPrompt] = useState("");

  const showImageChip = currentImageUrl && !imageRemoved;

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-2">
        {ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            onClick={() => setActiveAction((current) => (current === action.id ? null : action.id))}
            aria-pressed={activeAction === action.id}
            className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
              activeAction === action.id
                ? "border-blueprint bg-blueprint-soft text-blueprint"
                : "border-hairline text-secondary hover:border-hairline-strong hover:text-primary"
            }`}
          >
            {action.label}
            {action.hasMenu && (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path d="M2.5 4 5 6.5 7.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-1 flex-col rounded-lg border border-hairline">
        {showImageChip && (
          <div className="relative w-fit p-2.5 pb-0">
            <img src={currentImageUrl} alt="" className="h-20 w-20 rounded-md object-cover" />
            <button
              type="button"
              onClick={() => setImageRemoved(true)}
              aria-label="Remove image"
              className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white text-secondary shadow-sm hover:text-primary"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path d="m2 2 6 6M8 2 2 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
            <span className="absolute bottom-1 left-3 flex h-4 w-4 items-center justify-center rounded bg-primary/80 text-[10px] font-medium text-white">
              1
            </span>
          </div>
        )}

        <textarea
          value={editPrompt}
          onChange={(event) => setEditPrompt(event.target.value)}
          placeholder="Describe your edits..."
          className="min-h-[100px] flex-1 resize-none rounded-lg p-3 text-sm text-primary placeholder:text-faint focus:outline-none"
        />

        <div className="flex gap-3 px-3 pb-3 text-faint">
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
    </div>
  );
}
