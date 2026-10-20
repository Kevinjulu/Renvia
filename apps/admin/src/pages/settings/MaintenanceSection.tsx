import { Link } from "react-router-dom";
import { PauseCircle } from "lucide-react";
import type { Draft, FieldErrors } from "./types";
import { ToggleRow, Field, inputClass } from "./components";

export function MaintenanceSection({ draft, fieldErrors, update }: { draft: Draft; fieldErrors: FieldErrors; update: (patch: Partial<Draft>) => void }) {
  return (
    <section className="rounded-2xl border border-hairline bg-canvas p-5 shadow-card">
      <div className="mb-5 flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-rose-50 text-rose-600">
          <PauseCircle size={17} />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-primary">Maintenance</h2>
          <p className="text-xs text-muted">Instant pause for non-admins, no redeploy. To schedule a window ahead of time, use <Link to="/studio-control" className="text-blueprint underline">Studio Control</Link>; either one pauses work.</p>
        </div>
      </div>
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
    </section>
  );
}
