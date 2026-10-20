import { Link } from "react-router-dom";
import { PauseCircle } from "lucide-react";
import type { Draft, FieldErrors } from "./types";
import { ToggleRow, Field, inputClass, SettingsCard } from "./components";

export function MaintenanceSection({ draft, fieldErrors, update }: { draft: Draft; fieldErrors: FieldErrors; update: (patch: Partial<Draft>) => void }) {
  return (
    <SettingsCard icon={PauseCircle} title="Maintenance" hint={<>Instant pause for non-admins, no redeploy. To schedule a window ahead of time, use <Link to="/studio-control" className="text-blueprint underline">Studio Control</Link>; either one pauses work.</>} accent="rose" tone="danger" badge="Live switch" warning="Takes effect immediately and blocks new renders and selections for every non-admin.">
      <div className="space-y-4">
        <ToggleRow
          label="Pause renders"
          hint="Blocks create-render for non-admins."
          checked={draft.maintenanceRenders}
          onChange={(maintenanceRenders) => update({ maintenanceRenders })}
        />
        <ToggleRow
          label="Pause segmentations"
          hint="Blocks automatic selections for non-admins."
          checked={draft.maintenanceSegments}
          onChange={(maintenanceSegments) => update({ maintenanceSegments })}
        />
        <Field
          label="Message shown in studio"
          hint="Optional. Shown when maintenance blocks a request."
          error={fieldErrors.maintenanceMessage}
        >
          <textarea
            rows={3}
            maxLength={280}
            value={draft.maintenanceMessage}
            onChange={(event) => update({ maintenanceMessage: event.target.value })}
            placeholder="We’re upgrading the render pipeline — back shortly."
            className={`${inputClass(fieldErrors.maintenanceMessage)} resize-y`}
          />
        </Field>
      </div>
    </SettingsCard>
  );
}
