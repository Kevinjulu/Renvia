import { useState } from "react";
import type { ProtectedGeometryFeature, PromptRepairResponse, RenderSourceType } from "@renvia/types";
import { ReferenceBar } from "./ReferenceBar";
import { STYLE_INFLUENCE_LABELS, useGenerationSettingsStore } from "../../canvas/hooks/useGenerationSettingsStore";
import { useAccountStore } from "../../lib/useAccountStore";
import { SeedControl } from "./SeedControl";
import { AdvancedSection } from "./AdvancedSection";
import { GuideLabel } from "../../guide/HelpHotspot";
import { useApiClient } from "../../lib/apiClient";

/** Server default before /me has loaded — matches app_settings.max_prompt_chars's default. */
const DEFAULT_MAX_PROMPT_CHARS = 2000;

interface RenderTabBodyProps {
  prompt: string;
  onPromptChange: (value: string) => void;
}

const SOURCE_TYPES: { id: RenderSourceType; label: string; hint: string }[] = [
  { id: "photo", label: "Photo / 3D", hint: "A photo or 3D massing render of the building" },
  { id: "drawing", label: "Drawing", hint: "A CAD or line elevation — its lines are followed exactly" },
];

const PRESETS = [
  { label: "Golden hour", prompt: "Warm golden-hour light, long soft shadows and a calm premium atmosphere" },
  { label: "Soft daylight", prompt: "Soft overcast daylight, balanced exposure and natural architectural materials" },
  { label: "Lush landscape", prompt: "Lush considered landscaping, mature greenery and a refined residential setting" },
];

const PROTECTED_FEATURES: { id: ProtectedGeometryFeature; label: string }[] = [
  { id: "silhouette", label: "Silhouette" },
  { id: "roof", label: "Roof" },
  { id: "openings", label: "Openings" },
  { id: "massing", label: "Massing" },
  { id: "camera", label: "Camera" },
];

export function RenderTabBody({ prompt, onPromptChange }: RenderTabBodyProps) {
  const apiClient = useApiClient();
  const [repair, setRepair] = useState<PromptRepairResponse | null>(null);
  const [isRepairing, setIsRepairing] = useState(false);
  const sourceType = useGenerationSettingsStore((state) => state.sourceType);
  const setSourceType = useGenerationSettingsStore((state) => state.setSourceType);
  const styleInfluence = useGenerationSettingsStore((state) => state.styleInfluence);
  const setStyleInfluence = useGenerationSettingsStore((state) => state.setStyleInfluence);
  const preserveStructure = useGenerationSettingsStore((state) => state.preserveStructure);
  const setPreserveStructure = useGenerationSettingsStore((state) => state.setPreserveStructure);
  const fidelityMode = useGenerationSettingsStore((state) => state.fidelityMode);
  const setFidelityMode = useGenerationSettingsStore((state) => state.setFidelityMode);
  const protectedGeometry = useGenerationSettingsStore((state) => state.protectedGeometry);
  const setProtectedGeometry = useGenerationSettingsStore((state) => state.setProtectedGeometry);
  const geometryReviewedAt = useGenerationSettingsStore((state) => state.geometryReviewedAt);
  const confirmGeometryReview = useGenerationSettingsStore((state) => state.confirmGeometryReview);
  const referenceCount = useGenerationSettingsStore((state) => state.referenceImageUrls.length);
  const atmospherePreset = useGenerationSettingsStore((state) => state.atmospherePreset);
  const setAtmospherePreset = useGenerationSettingsStore((state) => state.setAtmospherePreset);
  const seed = useGenerationSettingsStore((state) => state.seed);
  const me = useAccountStore((state) => state.me);
  const maxPromptChars = me?.limits.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS;

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    const trimmed = prompt.trim();
    // Adds to whatever's already written instead of erasing it — a preset is a quick
    // addition, not a replacement for a prompt the user took the time to write.
    const merged = trimmed ? `${trimmed}${/[.!?]$/.test(trimmed) ? "" : "."} ${preset.prompt}` : preset.prompt;
    onPromptChange(merged.slice(0, maxPromptChars));
    setAtmospherePreset(preset.label);
  };

  const polishPrompt = async () => {
    setIsRepairing(true);
    try {
      setRepair(await apiClient.repairPrompt(prompt, referenceCount > 0));
    } finally {
      setIsRepairing(false);
    }
  };

  const toggleProtectedFeature = (feature: ProtectedGeometryFeature) => {
    setProtectedGeometry(
      protectedGeometry.includes(feature)
        ? protectedGeometry.filter((item) => item !== feature)
        : [...protectedGeometry, feature],
    );
  };

  const advancedSummary = [
    SOURCE_TYPES.find((option) => option.id === sourceType)?.label,
    `${STYLE_INFLUENCE_LABELS[styleInfluence - 1]} influence`,
    referenceCount > 0 ? "Reference structure lock" : preserveStructure ? "Structure kept" : "Loose structure",
    seed === null ? "Random seed" : `Seed ${seed}`,
  ].join(" · ");

  return (
    <div className="cp-tab-body">
      <div className="cp-direction" data-guide="control.direction">
        <div className="cp-prompt">
          <div className="cp-prompt-head">
            <label htmlFor="render-prompt">
              Prompt <span>optional</span>
            </label>
            <span>
              {prompt.length}/{maxPromptChars}
            </span>
          </div>
          <textarea
            id="render-prompt"
            value={prompt}
            onChange={(event) => {
              onPromptChange(event.target.value.slice(0, maxPromptChars));
              if (atmospherePreset) setAtmospherePreset(null);
            }}
            maxLength={maxPromptChars}
            placeholder="A modern house with wood cladding by the Swedish coast, surrounded by pine trees"
          />
          <div className="cp-chips" role="group" aria-label="Quick atmosphere">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className={atmospherePreset === preset.label ? "is-active" : ""}
                aria-pressed={atmospherePreset === preset.label}
                title={`Adds: "${preset.prompt}"`}
                onClick={() => applyPreset(preset)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="cp-prompt-tools">
            <button type="button" className="cp-prompt-polish" onClick={() => void polishPrompt()} disabled={isRepairing || !prompt.trim()}>
              {isRepairing ? "Polishing…" : "Polish prompt"}
            </button>
            <small>{referenceCount > 0 ? "Removes reference instructions that would redesign your source." : "Cleans up a short rendering brief."}</small>
          </div>
          {repair && (
            <div className="cp-prompt-repair" role="status">
              {repair.blocked.length > 0 && <p>Kept out: {repair.blocked.join(" · ")}</p>}
              {repair.prompt && <p>Ready to use: {repair.prompt}</p>}
              <div>
                <button
                  type="button"
                  disabled={!repair.prompt || repair.prompt === prompt}
                  onClick={() => {
                    onPromptChange(repair.prompt);
                    setRepair(null);
                  }}
                >
                  Use polished prompt
                </button>
                <button type="button" onClick={() => setRepair(null)}>Dismiss</button>
              </div>
            </div>
          )}
        </div>

        <section className="cp-card cp-references">
          <div className="cp-card-head">
            <strong>Reference images</strong>
            <span>Guides materials, light and setting</span>
          </div>
          <ReferenceBar />
        </section>
      </div>

      <AdvancedSection summary={advancedSummary}>
        <div className="cp-setting is-stacked" data-guide="control.source">
          <span>
            <strong>
              <GuideLabel topicId="control.source">Source</GuideLabel>
            </strong>
            <small>{SOURCE_TYPES.find((option) => option.id === sourceType)?.hint}</small>
          </span>
          <div className="cp-segmented is-small" role="group" aria-label="Source image type">
            {SOURCE_TYPES.map((option) => (
              <button
                key={option.id}
                type="button"
                title={option.hint}
                aria-pressed={sourceType === option.id}
                className={sourceType === option.id ? "is-active" : ""}
                onClick={() => setSourceType(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <label className="cp-setting is-stacked" data-guide="control.influence">
          <span>
            <strong>
              <GuideLabel topicId="control.influence">Style influence</GuideLabel>
            </strong>
            <small>How much of the references' look carries over</small>
          </span>
          <span className="cp-range">
            <input
              type="range"
              min="1"
              max="4"
              value={styleInfluence}
              onChange={(event) => setStyleInfluence(Number(event.target.value))}
            />
            <b>{STYLE_INFLUENCE_LABELS[styleInfluence - 1]}</b>
          </span>
        </label>
        <label className="cp-setting" data-guide="control.preserve">
          <span>
            <strong>
              <GuideLabel topicId="control.preserve">Preserve structure</GuideLabel>
            </strong>
            <small>
              {referenceCount > 0
                ? "Locked while references are attached — they can style, never redesign"
                : "Keep windows, roofs and massing as drawn"}
            </small>
          </span>
          <span className="cp-switch">
            <input
              type="checkbox"
              checked={preserveStructure}
              disabled={referenceCount > 0}
              onChange={(event) => setPreserveStructure(event.target.checked)}
            />
            <span aria-hidden="true" />
          </span>
        </label>
        {referenceCount > 0 && (
          <div className="cp-setting is-stacked cp-fidelity">
            <span>
              <strong>Source fidelity</strong>
              <small>Keep the source design fixed while references supply finishes, light and landscape.</small>
            </span>
            <div className="cp-segmented" role="group" aria-label="Source fidelity mode">
              <button type="button" className={fidelityMode === "strict" ? "is-active" : ""} aria-pressed={fidelityMode === "strict"} onClick={() => setFidelityMode("strict")}>Strict</button>
              <button type="button" className={fidelityMode === "standard" ? "is-active" : ""} aria-pressed={fidelityMode === "standard"} onClick={() => setFidelityMode("standard")}>Standard</button>
            </div>
            {fidelityMode === "strict" && (
              <>
                <div className="cp-chips is-wrap" role="group" aria-label="Protected source features">
                  {PROTECTED_FEATURES.map((feature) => (
                    <button key={feature.id} type="button" className={protectedGeometry.includes(feature.id) ? "is-active" : ""} aria-pressed={protectedGeometry.includes(feature.id)} onClick={() => toggleProtectedFeature(feature.id)}>
                      {feature.label}
                    </button>
                  ))}
                </div>
                <button type="button" className="cp-fidelity-review" onClick={confirmGeometryReview}>
                  {geometryReviewedAt ? "Source contract reviewed" : "Review protected source geometry"}
                </button>
              </>
            )}
          </div>
        )}
        <SeedControl />
      </AdvancedSection>
    </div>
  );
}
