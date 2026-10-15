import { useEffect } from "react";
import { upscaleCredits } from "@renvia/types";
import { creditPricesFor } from "../../lib/creditPrices";
import { useGenerationSettingsStore, type OutputResolution } from "../../canvas/hooks/useGenerationSettingsStore";
import { useAccountStore } from "../../lib/useAccountStore";
import { useUpgradeDialogStore } from "../../lib/useUpgradeDialog";

const OPTIONS: { id: OutputResolution; label: string; edge: number | null }[] = [
  { id: "standard", label: "Standard", edge: null },
  { id: "4k", label: "4K", edge: 3840 },
  { id: "8k", label: "8K", edge: 7680 },
];

function LockIcon() {
  return (
    <svg className="cp-lock" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

/**
 * The size renders are delivered at. 4K and 8K add an AI upscale to the same job, so the
 * download is already that size; Standard keeps the model's own output.
 */
export function OutputResolutionPicker() {
  const value = useGenerationSettingsStore((state) => state.outputResolution);
  const setValue = useGenerationSettingsStore((state) => state.setOutputResolution);
  const me = useAccountStore((state) => state.me);
  const features = useAccountStore((state) => (state.me?.role === "admin" ? undefined : state.me?.features));
  // Switched off in Studio Control: the option stays visible but can't be chosen.
  const unavailable = (option: OutputResolution) => {
    if (option === "standard") return null;
    const feature = features?.[option === "8k" ? "export.8k" : "export.4k"];
    return feature && !feature.available ? feature : null;
  };
  // A size the plan doesn't include (kept from an earlier session or a reused render) drops back to Standard.
  const planLocked = (option: OutputResolution) => unavailable(option)?.reason === "plan";
  const valueLocked = planLocked(value);
  useEffect(() => {
    if (valueLocked) setValue("standard");
  }, [valueLocked, setValue]);
  const askUpgrade = useUpgradeDialogStore((state) => state.ask);
  const extraCredits = (option: OutputResolution) => (option === "standard" ? 0 : upscaleCredits(option, creditPricesFor(me)));
  const selected = OPTIONS.find((option) => option.id === value)!;
  const extra = extraCredits(value);

  return (
    <div className="cp-resolution">
      <p className="cp-field-label">Output resolution</p>
      <div className="cp-segmented" role="radiogroup" aria-label="Output resolution">
        {OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={value === option.id}
            className={`${value === option.id ? "is-active" : ""} ${planLocked(option.id) ? "is-locked" : ""}`}
            // Outside the plan it stays clickable and explains the upgrade; switched off, it can't be chosen.
            disabled={Boolean(unavailable(option.id)) && !planLocked(option.id) && value !== option.id}
            title={planLocked(option.id) ? `${option.label} comes with a paid plan` : unavailable(option.id)?.message ?? undefined}
            onClick={() => (planLocked(option.id) ? askUpgrade(option.id === "8k" ? "export.8k" : "export.4k") : setValue(option.id))}
          >
            {planLocked(option.id) && <LockIcon />}
            {option.label}
            {option.id !== "standard" && !planLocked(option.id) && <em>+{extraCredits(option.id)}</em>}
          </button>
        ))}
      </div>
      <small className="cp-resolution-hint">
        {unavailable(value)
          ? unavailable(value)!.message ?? `${selected.label} isn't available right now. Choose another size.`
          : selected.edge
          ? `AI-upscaled to ${selected.edge.toLocaleString()} px, ready to download · +${extra} ${extra === 1 ? "credit" : "credits"} per image`
          : planLocked("4k")
          ? "The render's own size. 4K and 8K come with a paid plan."
          : planLocked("8k")
          ? "The render's own size. 8K comes with Premium."
          : "The render's own size. You can still upscale a finished render from its card."}
      </small>
    </div>
  );
}
