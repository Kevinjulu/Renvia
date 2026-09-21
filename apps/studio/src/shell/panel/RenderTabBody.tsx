import type { RenderSourceType } from "@renvia/types";
import { ReferenceBar } from "./ReferenceBar";
import { STYLE_INFLUENCE_LABELS, useGenerationSettingsStore } from "../../canvas/hooks/useGenerationSettingsStore";
import { useAccountStore } from "../../lib/useAccountStore";
import { SeedControl } from "./SeedControl";
import { AdvancedSection } from "./AdvancedSection";
import { GuideLabel } from "../../guide/HelpHotspot";

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

export function RenderTabBody({ prompt, onPromptChange }: RenderTabBodyProps) {
  const sourceType = useGenerationSettingsStore((state) => state.sourceType);
  const setSourceType = useGenerationSettingsStore((state) => state.setSourceType);
  const styleInfluence = useGenerationSettingsStore((state) => state.styleInfluence);
  const setStyleInfluence = useGenerationSettingsStore((state) => state.setStyleInfluence);
  const preserveStructure = useGenerationSettingsStore((state) => state.preserveStructure);
  const setPreserveStructure = useGenerationSettingsStore((state) => state.setPreserveStructure);
  const atmospherePreset = useGenerationSettingsStore((state) => state.atmospherePreset);
  const setAtmospherePreset = useGenerationSettingsStore((state) => state.setAtmospherePreset);
  const seed = useGenerationSettingsStore((state) => state.seed);
  const me = useAccountStore((state) => state.me);
  const maxPromptChars = me?.limits.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS;

  const advancedSummary = [
    SOURCE_TYPES.find((option) => option.id === sourceType)?.label,
    `${STYLE_INFLUENCE_LABELS[styleInfluence - 1]} influence`,
    preserveStructure ? "Structure kept" : "Loose structure",
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
                title={preset.prompt}
                onClick={() => {
                  onPromptChange(preset.prompt);
                  setAtmospherePreset(preset.label);
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
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
            <small>Keep windows, roofs and massing as drawn</small>
          </span>
          <span className="cp-switch">
            <input
              type="checkbox"
              checked={preserveStructure}
              onChange={(event) => setPreserveStructure(event.target.checked)}
            />
            <span aria-hidden="true" />
          </span>
        </label>
        <SeedControl />
      </AdvancedSection>
    </div>
  );
}
