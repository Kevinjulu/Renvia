import { MessageSquare } from "lucide-react";
import type { Draft, FieldErrors } from "./types";
import { REFUSAL_MESSAGE_FIELDS } from "./constants";
import { Field, inputClass } from "./components";

export function BlockedMessagesSection({ draft, fieldErrors, update }: { draft: Draft; fieldErrors: FieldErrors; update: (patch: Partial<Draft>) => void }) {
  return (
    <section className="rounded-2xl border border-hairline bg-canvas p-5 shadow-card lg:col-span-2">
      <div className="mb-5 flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-glow-soft text-[#8a5a17]">
          <MessageSquare size={17} />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-primary">What users see when they’re blocked</h2>
          <p className="text-xs text-muted">
            Shown in the studio’s limit dialog. Leave blank to use the built-in wording.
          </p>
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {REFUSAL_MESSAGE_FIELDS.map((field) => (
          <Field key={field.key} label={field.label} hint={field.hint} error={fieldErrors[field.key]}>
            <textarea
              rows={2}
              maxLength={280}
              value={draft[field.key]}
              onChange={(event) => update({ [field.key]: event.target.value } as Partial<Draft>)}
              placeholder={field.placeholder}
              className={`${inputClass(fieldErrors[field.key])} resize-y`}
            />
          </Field>
        ))}
      </div>
    </section>
  );
}
