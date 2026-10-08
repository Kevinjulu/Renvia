import { SlidersHorizontal } from "lucide-react";
import type { Draft, FieldErrors } from "./types";
import { Field, inputClass } from "./components";

export function InputLimitsSection({ draft, fieldErrors, update }: { draft: Draft; fieldErrors: FieldErrors; update: (patch: Partial<Draft>) => void }) {
  return (
    <section className="rounded-2xl border border-hairline bg-canvas p-5 shadow-card">
      <div className="mb-5 flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-blueprint-soft text-blueprint">
          <SlidersHorizontal size={17} />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-primary">Input limits</h2>
          <p className="text-xs text-muted">What a single request may carry</p>
        </div>
      </div>
      <div className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Max upload size (MB)"
            hint="Rejected server-side before the image is stored."
            error={fieldErrors.maxUploadMb}
          >
            <input
              type="number"
              min={1}
              max={100}
              value={draft.maxUploadMb}
              onChange={(event) => update({ maxUploadMb: event.target.value })}
              className={inputClass(fieldErrors.maxUploadMb)}
            />
          </Field>
          <Field
            label="Max reference images"
            hint="Per render. 0 disables reference-image renders."
            error={fieldErrors.maxReferenceImages}
          >
            <input
              type="number"
              min={0}
              max={16}
              value={draft.maxReferenceImages}
              onChange={(event) => update({ maxReferenceImages: event.target.value })}
              className={inputClass(fieldErrors.maxReferenceImages)}
            />
          </Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Max prompt characters"
            hint="Render and edit prompts. 50–8,000."
            error={fieldErrors.maxPromptChars}
          >
            <input
              type="number"
              min={50}
              max={8000}
              value={draft.maxPromptChars}
              onChange={(event) => update({ maxPromptChars: event.target.value })}
              className={inputClass(fieldErrors.maxPromptChars)}
            />
          </Field>
          <Field
            label="Max selection prompt characters"
            hint="“Auto select” text prompts. 10–1,000."
            error={fieldErrors.maxSelectionPromptChars}
          >
            <input
              type="number"
              min={10}
              max={1000}
              value={draft.maxSelectionPromptChars}
              onChange={(event) => update({ maxSelectionPromptChars: event.target.value })}
              className={inputClass(fieldErrors.maxSelectionPromptChars)}
            />
          </Field>
        </div>
        <Field
          label="Max projects per user"
          hint="Blank for unlimited. Checked when a non-admin creates a project."
          error={fieldErrors.maxProjectsPerUser}
        >
          <input
            type="number"
            min={1}
            max={10_000}
            placeholder="Unlimited"
            value={draft.maxProjectsPerUser}
            onChange={(event) => update({ maxProjectsPerUser: event.target.value })}
            className={inputClass(fieldErrors.maxProjectsPerUser)}
          />
        </Field>
      </div>
    </section>
  );
}
