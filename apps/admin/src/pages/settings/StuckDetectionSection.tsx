import { Timer } from "lucide-react";
import type { Draft, FieldErrors } from "./types";
import { Field, inputClass } from "./components";

export function StuckDetectionSection({ draft, fieldErrors, update }: { draft: Draft; fieldErrors: FieldErrors; update: (patch: Partial<Draft>) => void }) {
  return (
    <section className="rounded-2xl border border-hairline bg-canvas p-5 shadow-card">
      <div className="mb-5 flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-surface-muted text-muted">
          <Timer size={17} />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-primary">Stuck detection</h2>
          <p className="text-xs text-muted">How long before pending jobs count as stuck</p>
        </div>
      </div>
      <Field
        label="Stuck timeout (minutes)"
        hint="Renders (pending/processing) and segmentations (pending) older than this appear as stuck on Overview and job lists."
        error={fieldErrors.stuckTimeoutMinutes}
      >
        <input
          type="number"
          min={1}
          max={1440}
          value={draft.stuckTimeoutMinutes}
          onChange={(event) => update({ stuckTimeoutMinutes: event.target.value })}
          className={inputClass(fieldErrors.stuckTimeoutMinutes)}
        />
      </Field>
    </section>
  );
}
