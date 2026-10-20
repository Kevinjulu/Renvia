import { Link } from "react-router-dom";
import { Shield } from "lucide-react";

import { SettingsCard } from "./components";

export function ExemptionsSection() {
  return (
    <SettingsCard icon={Shield} title="Exemptions" hint="Who skips limits and charges" accent="blue">
      <div className="rounded-xl border border-hairline bg-surface px-3.5 py-3 text-sm text-secondary">
        <p className="font-medium text-primary">Admins</p>
        <p className="mt-1 text-xs text-muted">
          Exempt from daily render/segment limits, maintenance pauses, and credit charges. Their jobs still count
          toward the global fal budget.
        </p>
      </div>
      <div className="mt-3 rounded-xl border border-hairline bg-surface px-3.5 py-3 text-sm text-secondary">
        <p className="font-medium text-primary">Exempt users</p>
        <p className="mt-1 text-xs text-muted">
          Any account can be flagged exempt, or given its own daily/monthly allowance, from{" "}
          <Link to="/users" className="font-medium text-blueprint hover:underline">
            Users
          </Link>
          . Exempt users skip caps and maintenance but are still charged credits.
        </p>
      </div>
    </SettingsCard>
  );
}
