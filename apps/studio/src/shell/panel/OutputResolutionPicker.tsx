import { upscaleCreditCost } from "@renvia/types";
import { useGenerationSettingsStore, type OutputResolution } from "../../canvas/hooks/useGenerationSettingsStore";
import { useAccountStore } from "../../lib/useAccountStore";

const OPTIONS: { id: OutputResolution; label: string; edge: number | null }[] = [
  { id: "standard", label: "Standard", edge: null },
  { id: "4k", label: "4K", edge: 3840 },
  { id: "8k", label: "8K", edge: 7680 },
];

/**
 * The size renders are delivered at. 4K and 8K add an AI upscale to the same job, so the
 * download is already that size; Standard keeps the model's own output.
 */
export function OutputResolutionPicker() {
  const value = useGenerationSettingsStore((state) => state.outputResolution);
  const setValue = useGenerationSettingsStore((state) => state.setOutputResolution);
  const creditsPerImage = useAccountStore((state) => state.me?.creditsPerImage ?? 1);
  const features = useAccountStore((state) => (state.me?.role === "admin" ? undefined : state.me?.features));
  // Switched off in Studio Control: the option stays visible but can't be chosen.
  const unavailable = (option: OutputResolution) => {
    if (option === "standard") return null;
    const feature = features?.[option === "8k" ? "export.8k" : "export.4k"];
    return feature && !feature.available ? feature : null;
  };
  const extraCredits = (option: OutputResolution) => (option === "standard" ? 0 : upscaleCreditCost(option) * creditsPerImage);
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
            className={value === option.id ? "is-active" : ""}
            disabled={Boolean(unavailable(option.id)) && value !== option.id}
            title={unavailable(option.id)?.message ?? undefined}
            onClick={() => setValue(option.id)}
          >
            {option.label}
            {option.id !== "standard" && <em>+{extraCredits(option.id)}</em>}
          </button>
        ))}
      </div>
      <small className="cp-resolution-hint">
        {unavailable(value)
          ? unavailable(value)!.message ?? `${selected.label} isn't available right now. Choose another size.`
          : selected.edge
          ? `AI-upscaled to ${selected.edge.toLocaleString()} px, ready to download · +${extra} ${extra === 1 ? "credit" : "credits"} per image`
          : "The render's own size. You can still upscale a finished render from its card."}
      </small>
    </div>
  );
}
