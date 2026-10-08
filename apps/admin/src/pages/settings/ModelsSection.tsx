import { Layers } from "lucide-react";
import type { AdminSettings } from "@renvia/types";
import { formatUsd } from "../../lib/format";
import { MODE_LABEL, ROUTE_LABEL } from "./constants";

export function ModelsSection({ data }: { data: AdminSettings }) {
  return (
    <section className="rounded-2xl border border-hairline bg-canvas p-5 shadow-card">
      <div className="mb-4 flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-surface-muted text-muted">
          <Layers size={17} />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-primary">Models · {MODE_LABEL[data.effectiveMode]}</h2>
          <p className="text-xs text-muted">Current mode pricing (read-only)</p>
        </div>
      </div>
      <ul className="divide-y divide-hairline rounded-xl border border-hairline">
        {data.models.map((model) => (
          <li key={model.route} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
            <span>
              <span className="block font-medium text-primary">{ROUTE_LABEL[model.route]}</span>
              <span className="block truncate text-xs text-faint">{model.modelId}</span>
            </span>
            <span className="shrink-0 tabular-nums text-muted">{formatUsd(model.costUsd)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-faint">Automatic selections use fal SAM 3 at ~$0.005 when not in mock mode.</p>
    </section>
  );
}
