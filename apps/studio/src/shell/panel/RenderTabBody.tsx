import { useState } from "react";
import { useRenderJobsStore } from "../../canvas/hooks/useRenderJobsStore";
import { ReferenceBar } from "./ReferenceBar";

interface RenderTabBodyProps {
  prompt: string;
  onPromptChange: (value: string) => void;
}

const PRESETS = [
  { label: "Golden hour", prompt: "Warm golden-hour light, long soft shadows and a calm premium atmosphere" },
  { label: "Soft daylight", prompt: "Soft overcast daylight, balanced exposure and natural architectural materials" },
  { label: "Lush landscape", prompt: "Lush considered landscaping, mature greenery and a refined residential setting" },
];

export function RenderTabBody({ prompt, onPromptChange }: RenderTabBodyProps) {
  const [advancedOpen, setAdvancedOpen] = useState(true);
  const [styleInfluence, setStyleInfluence] = useState(2);
  const jobs = useRenderJobsStore((state) => state.jobs);
  const setActiveJob = useRenderJobsStore((state) => state.setActiveJob);
  const recentJobs = jobs.filter((job) => job.resultImageUrl).slice(0, 3);

  return (
    <div className="render-panel-body flex flex-1 flex-col">
      <div className="prompt-heading"><p>Prompt <span>(optional)</span></p><span>{prompt.length}/500</span></div>
      <textarea
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        maxLength={500}
        placeholder="Example: A modern house with wood cladding by the Swedish coast, surrounded by pine trees"
        className="studio-prompt-input resize-none rounded-lg border border-hairline p-3 text-sm text-primary placeholder:text-faint focus:border-blueprint focus:outline-none"
      />

      <div className="studio-preset-section">
        <div className="studio-section-heading"><strong>Quick atmosphere</strong><span>Optional</span></div>
        <div className="studio-preset-chips">
          {PRESETS.map((preset) => (
            <button key={preset.label} type="button" onClick={() => onPromptChange(preset.prompt)}>{preset.label}</button>
          ))}
        </div>
      </div>

      <div className={`studio-advanced ${advancedOpen ? "is-open" : ""}`}>
        <button className="studio-advanced-toggle" type="button" onClick={() => setAdvancedOpen((open) => !open)} aria-expanded={advancedOpen}>
          <span><strong>Advanced settings</strong><small>Control how closely the render follows your view</small></span>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="m4 5.5 3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        {advancedOpen && (
          <div className="studio-advanced-content">
            <label className="studio-influence-control">
              <span><strong>Style influence</strong><small>Balanced</small></span>
              <div><input type="range" min="1" max="4" value={styleInfluence} onChange={(event) => setStyleInfluence(Number(event.target.value))} /><b>{styleInfluence}</b></div>
            </label>
            <label className="studio-preserve-control">
              <span><strong>Preserve structure</strong><small>Keep openings and camera angle intact</small></span>
              <input type="checkbox" defaultChecked />
            </label>
            <div className="studio-reference-control">
              <span className="studio-reference-icon">▧</span>
              <p><strong>Reference images</strong><small>Guide materials, lighting or surroundings</small></p>
              <ReferenceBar />
            </div>
          </div>
        )}
      </div>

      <div className="studio-context-card">
        {recentJobs.length > 0 ? (
          <>
            <div className="studio-section-heading"><strong>Recent renders</strong><span>{recentJobs.length} latest</span></div>
            <div className="studio-recent-renders">
              {recentJobs.map((job) => (
                <button key={job.id} type="button" onClick={() => setActiveJob(job.id)} title="Open render">
                  <img src={job.resultImageUrl ?? job.sourceImageUrl} alt="" /><span>View</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="studio-ready-card">
            <span>✦</span>
            <p><strong>Ready for a clean first render</strong><small>Add an atmosphere or generate directly. Structure preservation is already on.</small></p>
          </div>
        )}
      </div>
    </div>
  );
}
