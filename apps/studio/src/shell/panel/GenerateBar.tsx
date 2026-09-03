import { useState } from "react";
import { useApiClient } from "../../lib/apiClient";
import { useGenerationSettingsStore } from "../../canvas/hooks/useGenerationSettingsStore";
import { useRenderJobsStore } from "../../canvas/hooks/useRenderJobsStore";

const COUNT_OPTIONS = [1, 2, 3, 4];

interface GenerateBarProps {
  projectId: string;
  sourceImageUrl: string | null;
  prompt: string;
}

export function GenerateBar({ projectId, sourceImageUrl, prompt }: GenerateBarProps) {
  const apiClient = useApiClient();
  const resolution = useGenerationSettingsStore((state) => state.resolution);
  const style = useGenerationSettingsStore((state) => state.style);
  const addJob = useRenderJobsStore((state) => state.addJob);
  const [count, setCount] = useState(2);
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canGenerate = Boolean(sourceImageUrl) && prompt.trim().length > 0 && !isSubmitting;

  const handleGenerate = async () => {
    if (!sourceImageUrl) return;
    setIsSubmitting(true);
    setStatus(null);
    try {
      const results = await Promise.all(
        Array.from({ length: count }, () =>
          apiClient.createRender({ projectId, sourceImageUrl, prompt, resolution, style }),
        ),
      );
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
          {isSubmitting ? "Queuing…" : "Generate"}
        </button>
        <select
          value={count}
          onChange={(event) => setCount(Number(event.target.value))}
          aria-label="Number of variations"
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
