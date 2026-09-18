import { useState } from "react";
import { useApiClient } from "../../lib/apiClient";
import { useGenerationSettingsStore } from "../../canvas/hooks/useGenerationSettingsStore";
import { useRenderJobsStore } from "../../canvas/hooks/useRenderJobsStore";
import { useCanvasStore } from "../../canvas/hooks/useCanvasStore";
import { filledBuildingViews, nodeForView } from "../../canvas/buildingViews";

const COUNT_OPTIONS = [1, 2, 3, 4];

interface GenerateBarProps {
  projectId: string;
  prompt: string;
}

export function GenerateBar({ projectId, prompt }: GenerateBarProps) {
  const apiClient = useApiClient();
  const views = useCanvasStore((state) => state.views);
  const nodes = useCanvasStore((state) => state.nodes);
  const resolution = useGenerationSettingsStore((state) => state.resolution);
  const style = useGenerationSettingsStore((state) => state.style);
  const addJob = useRenderJobsStore((state) => state.addJob);
  const [count, setCount] = useState(2);
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const filled = filledBuildingViews(views, nodes);
  const jobCount = filled.length * count;
  const canGenerate = filled.length > 0 && !isSubmitting;

  const viewWord = filled.length === 1 ? "view" : "views";
  const buttonLabel = (() => {
    if (isSubmitting) return "Queuing…";
    if (filled.length === 0) return "Generate";
    if (count === 1) return `Generate ${filled.length} ${viewWord}`;
    return `Generate ${filled.length} ${viewWord} × ${count}`;
  })();

  const handleGenerate = async () => {
    if (filled.length === 0) return;
    setIsSubmitting(true);
    setStatus(null);
    try {
      const requests = filled.flatMap((view) => {
        const node = nodeForView(nodes, view.id);
        if (!node) return [];
        return Array.from({ length: count }, () =>
          apiClient.createRender({
            projectId,
            sourceImageUrl: node.imageUrl,
            prompt: prompt.trim() || "Photorealistic architectural visualization matching this elevation",
            resolution,
            style,
            viewKey: view.id,
            viewLabel: view.label,
          }),
        );
      });
      const results = await Promise.all(requests);
      results.forEach(({ job }) => addJob(job));
      setStatus(null);
    } catch {
      setStatus("Couldn't queue the render. Try again in a moment.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      <div className="studio-generation-summary">
        <span>{resolution} · {style}</span>
        <span>
          {filled.length === 0
            ? "Upload a view to generate"
            : `${filled.length} ${viewWord}${count > 1 ? ` × ${count} variations` : ""} · ${jobCount} ${jobCount === 1 ? "job" : "jobs"}`}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!canGenerate}
          onClick={() => void handleGenerate()}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M7 1.5 8.4 5.6 12.5 7 8.4 8.4 7 12.5 5.6 8.4 1.5 7l4.1-1.4Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          {buttonLabel}
        </button>
        <select
          value={count}
          onChange={(event) => setCount(Number(event.target.value))}
          aria-label="Number of variations per view"
          className="rounded-lg border border-hairline px-2 py-2.5 text-sm text-primary"
        >
          {COUNT_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
      {status && <p className="mt-2 text-xs text-muted">{status}</p>}
    </div>
  );
}
