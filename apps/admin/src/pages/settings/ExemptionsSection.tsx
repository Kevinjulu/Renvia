import { Link } from "react-router-dom";
import { Shield } from "lucide-react";

export function ExemptionsSection() {
  return (
    <section className="rounded-2xl border border-hairline bg-canvas p-5 shadow-card">
      <div className="mb-4 flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-blueprint-soft text-blueprint">
          <Shield size={17} />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-primary">Exemptions</h2>
          <p className="text-xs text-muted">Who skips limits and charges</p>
        </div>
      </div>
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
    </section>
  );
}
