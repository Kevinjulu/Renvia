import { useState } from "react";
import { useGenerationSettingsStore } from "../../canvas/hooks/useGenerationSettingsStore";

const MAX_SEED = 2_147_483_647;

function randomSeed(): number {
  return Math.floor(Math.random() * MAX_SEED);
}

/**
 * Blank (the normal case) means a fresh random seed every time. Setting one reproduces a
 * past render exactly, or — paired with a changed prompt or strength — nudges it instead of
 * starting over. Shared between the Render and Edit tabs: one seed, whichever tab is active.
 */
export function SeedControl() {
  const seed = useGenerationSettingsStore((state) => state.seed);
  const setSeed = useGenerationSettingsStore((state) => state.setSeed);
  const [draft, setDraft] = useState("");
  const locked = seed !== null;

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-hairline px-3 py-2">
      <div className="min-w-0">
        <p className="text-xs font-medium text-primary">Seed</p>
        <p className="truncate text-[11px] text-faint">
          {locked ? "Locked — reruns reproduce this exact result." : "Random each time. Lock one to reproduce or nudge a result."}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {locked ? (
          <>
            <span className="rounded-md bg-surface-muted px-2 py-1 text-xs font-medium tabular-nums text-secondary">{seed}</span>
            <button
              type="button"
              title="Use a random seed again"
              aria-label="Clear seed"
              onClick={() => setSeed(null)}
              className="grid h-6 w-6 place-items-center rounded-md text-faint hover:bg-surface-muted hover:text-primary"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path d="m1.5 1.5 7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
          </>
        ) : (
          <>
            <input
              type="number"
              min={0}
              max={MAX_SEED}
              value={draft}
              placeholder="Random"
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => {
                const parsed = Number(draft);
                if (draft.trim() && Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_SEED) setSeed(parsed);
                setDraft("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") (event.target as HTMLInputElement).blur();
              }}
              className="w-24 rounded-md border border-hairline px-2 py-1 text-xs tabular-nums text-primary placeholder:text-faint focus:border-blueprint focus:outline-none"
            />
            <button
              type="button"
              title="Lock a random seed"
              aria-label="Lock a random seed"
              onClick={() => setSeed(randomSeed())}
              className="grid h-6 w-6 place-items-center rounded-md text-faint hover:bg-surface-muted hover:text-primary"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <rect x="1.5" y="1.5" width="9" height="9" rx="1.8" stroke="currentColor" strokeWidth="1.1" />
                <circle cx="4" cy="4" r="0.8" fill="currentColor" />
                <circle cx="8" cy="4" r="0.8" fill="currentColor" />
                <circle cx="4" cy="8" r="0.8" fill="currentColor" />
                <circle cx="8" cy="8" r="0.8" fill="currentColor" />
                <circle cx="6" cy="6" r="0.8" fill="currentColor" />
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
