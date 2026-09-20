import type { RenderSourceType } from "@renvia/types";
import { ReferenceBar } from "./ReferenceBar";
import { useRenderJobsStore } from "../../canvas/hooks/useRenderJobsStore";
import { useGenerationSettingsStore } from "../../canvas/hooks/useGenerationSettingsStore";
import { GuideLabel } from "../../guide/HelpHotspot";

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

  const jobs = useRenderJobsStore((state) => state.jobs);
  const setActiveJob = useRenderJobsStore((state) => state.setActiveJob);
  const recentJobs = jobs.filter((job) => job.resultImageUrl).slice(0, 3);

  return (
    <div className="render-panel-body flex flex-1 flex-col">
      <div data-guide="control.direction">
      <div className="prompt-heading">
        <p>
          Prompt <span>(optional)</span>
        </p>
        <span>{prompt.length}/500</span>
      </div>
      <textarea
        value={prompt}
        onChange={(event) => {
          onPromptChange(event.target.value);
          if (atmospherePreset) setAtmospherePreset(null);
        }}
        maxLength={500}
        placeholder="Example: A modern house with wood cladding by the Swedish coast, surrounded by pine trees"
        className="studio-prompt-input resize-none rounded-lg border border-hairline p-3 text-primary placeholder:text-faint focus:border-blueprint focus:outline-none"
      />

      <section className="reference-panel">
        <div className="studio-section-heading">
          <strong>Reference images</strong>
          <span>Guides the AI</span>
        </div>
        <p className="reference-panel-hint">
          The AI blends these with your uploaded elevation to match materials, lighting and surroundings.
        </p>
        <ReferenceBar />
      </section>
      </div>

      <div className="render-controls">
        <div className="studio-source-control" data-guide="control.source">
          <strong>
            <GuideLabel topicId="control.source">Source</GuideLabel>
          </strong>
          <div role="group" aria-label="Source image type">
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
        <label className="studio-influence-control" data-guide="control.influence">
          <strong>
            <GuideLabel topicId="control.influence">Style influence</GuideLabel>
          </strong>
          <div>
            <input
              type="range"
              min="1"
              max="4"
              value={styleInfluence}
              onChange={(event) => setStyleInfluence(Number(event.target.value))}
            />
            <b>{styleInfluence}</b>
          </div>
        </label>
        <label className="studio-preserve-control" data-guide="control.preserve">
          <strong>
            <GuideLabel topicId="control.preserve">Preserve structure</GuideLabel>
          </strong>
          <input
            type="checkbox"
            checked={preserveStructure}
            onChange={(event) => setPreserveStructure(event.target.checked)}
          />
        </label>
      </div>

      <div className="studio-preset-section">
        <div className="studio-section-heading">
          <strong>Quick atmosphere</strong>
          <span>Optional</span>
        </div>
        <div className="studio-preset-chips">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className={atmospherePreset === preset.label ? "is-active" : ""}
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

      {recentJobs.length > 0 && (
        <div className="studio-context-card">
          <div className="studio-section-heading">
            <strong>Recent renders</strong>
            <span>{recentJobs.length} latest</span>
          </div>
          <div className="studio-recent-renders">
            {recentJobs.map((job) => (
              <button
                key={job.id}
                type="button"
                onClick={() => setActiveJob(job.id)}
                title={job.viewLabel ?? "Open render"}
              >
                <img src={job.resultImageUrl ?? job.sourceImageUrl} alt="" />
                <span>{job.viewLabel ?? "View"}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
