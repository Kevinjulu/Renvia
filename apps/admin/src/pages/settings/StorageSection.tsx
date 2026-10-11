import { HardDrive } from "lucide-react";
import type { AdminSettings } from "@renvia/types";
import { formatNumber } from "../../lib/format";
import type { Draft, FieldErrors } from "./types";
import { Field, inputClass } from "./components";

/** Bytes as Cloudflare counts them: 1 GB = 10^9 bytes. */
function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.round(bytes / 1e3)} KB`;
}

const KIND_LABELS = { render: "Renders & 4K/8K", upload: "Uploads & references", watermark: "Watermarked copies" } as const;

/**
 * Image storage against its cap. Cloudflare R2's free tier is 10 GB; the cap stops new uploads
 * and renders before stored images get there, so storage is never billed.
 */
export function StorageSection({ data, draft, fieldErrors, update }: { data: AdminSettings; draft: Draft; fieldErrors: FieldErrors; update: (patch: Partial<Draft>) => void }) {
  const { usedBytes, capBytes, objects, byKind } = data.storage;
  const ratio = capBytes > 0 ? Math.min(1, usedBytes / capBytes) : 1;
  const tone = ratio >= 0.9 ? "bg-rose-500" : ratio >= 0.7 ? "bg-[#c45c26]" : "bg-emerald-500";

  return (
    <section className="rounded-2xl border border-hairline bg-canvas p-5 shadow-card">
      <div className="mb-5 flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-blueprint-soft text-blueprint">
          <HardDrive size={17} />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-primary">Image storage</h2>
          <p className="text-xs text-muted">Cloudflare R2 — free up to 10 GB</p>
        </div>
      </div>

      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="font-semibold tabular-nums text-primary">{formatBytes(usedBytes)}</span>
        <span className="text-xs text-muted">of {formatBytes(capBytes)} cap · {Math.round(ratio * 100)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-muted" role="meter" aria-valuemin={0} aria-valuemax={capBytes} aria-valuenow={usedBytes} aria-label="Image storage used">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${ratio * 100}%` }} />
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        {(Object.keys(KIND_LABELS) as (keyof typeof KIND_LABELS)[]).map((kind) => (
          <div key={kind}>
            <dt className="text-faint">{KIND_LABELS[kind]}</dt>
            <dd className="font-medium tabular-nums text-primary">{formatBytes(byKind[kind])}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-faint">{formatNumber(objects)} stored files. Overview warns at 70% and 90%.</p>

      <div className="mt-5">
        <Field
          label="Storage cap (MB)"
          hint="New uploads and renders are refused once stored images reach this. At most 10,000 MB (the free 10 GB); keep a margin for files saved while requests are in flight."
          error={fieldErrors.storageCapMb}
        >
          <input type="number" min={100} max={10000} value={draft.storageCapMb} onChange={(event) => update({ storageCapMb: event.target.value })} className={inputClass(fieldErrors.storageCapMb)} />
        </Field>
      </div>
    </section>
  );
}
