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
            onClick={() => setValue(option.id)}
          >
            {option.label}
            {option.id !== "standard" && <em>+{extraCredits(option.id)}</em>}
          </button>
        ))}
      </div>
      <small className="cp-resolution-hint">
        {selected.edge
          ? `AI-upscaled to ${selected.edge.toLocaleString()} px, ready to download · +${extra} ${extra === 1 ? "credit" : "credits"} per image`
          : "The render's own size. You can still upscale a finished render from its card."}
      </small>
    </div>
  );
}
