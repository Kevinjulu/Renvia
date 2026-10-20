import { Link } from "react-router-dom";
import { Layers } from "lucide-react";
import type { AdminSettings } from "@renvia/types";
import { formatUsd } from "../../lib/format";
import { MODE_LABEL, ROUTE_LABEL } from "./constants";

import { SettingsCard } from "./components";

export function ModelsSection({ data }: { data: AdminSettings }) {
  return (
    <SettingsCard icon={Layers} title={<>Models · {MODE_LABEL[data.effectiveMode]}</>} hint={<>Current mode pricing (read-only). To pause a failing model or see its reliability, use the <Link to="/models" className="text-blueprint underline">Model Registry</Link>.</>} accent="neutral">
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
    </SettingsCard>
  );
}
