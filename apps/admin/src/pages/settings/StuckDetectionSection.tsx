import { Timer } from "lucide-react";
import type { Draft, FieldErrors } from "./types";
import { Field, inputClass, SettingsCard } from "./components";

export function StuckDetectionSection({ draft, fieldErrors, update }: { draft: Draft; fieldErrors: FieldErrors; update: (patch: Partial<Draft>) => void }) {
  return (
    <SettingsCard icon={Timer} title="Stuck detection" hint="How long before pending jobs count as stuck" accent="neutral">
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
    </SettingsCard>
  );
}
