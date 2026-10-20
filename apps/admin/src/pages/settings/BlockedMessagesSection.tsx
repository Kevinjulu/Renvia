import { MessageSquare } from "lucide-react";
import type { Draft, FieldErrors } from "./types";
import { REFUSAL_MESSAGE_FIELDS } from "./constants";
import { Field, inputClass, SettingsCard } from "./components";

export function BlockedMessagesSection({ draft, fieldErrors, update }: { draft: Draft; fieldErrors: FieldErrors; update: (patch: Partial<Draft>) => void }) {
  return (
    <SettingsCard icon={MessageSquare} title="What users see when they’re blocked" hint="
            Shown in the studio’s limit dialog. Leave blank to use the built-in wording.
          " accent="amber">
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
    </SettingsCard>
  );
}
