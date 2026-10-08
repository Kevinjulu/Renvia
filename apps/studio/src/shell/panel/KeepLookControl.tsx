import { useGenerationSettingsStore } from "../../canvas/hooks/useGenerationSettingsStore";
import { useRenderJobsStore } from "../../canvas/hooks/useRenderJobsStore";

/**
 * The plain-language face of the render seed. By default every render is a fresh take.
 * Keeping a look pins the seed of a render the person liked, so changing the prompt or a
 * setting refines that render instead of starting over. The number itself is never shown.
 * Shared between the Render and Edit tabs: one setting, whichever tab is active.
 */
export function KeepLookControl() {
  const seed = useGenerationSettingsStore((state) => state.seed);
  const setSeed = useGenerationSettingsStore((state) => state.setSeed);
  // The look of the render being viewed; null until one exists (older renders may have no seed).
  const viewedSeed = useRenderJobsStore((state) => state.jobs.find((job) => job.id === state.activeJobId)?.seed ?? null);
  const keeping = seed !== null;
  const canKeep = keeping || viewedSeed !== null;

  return (
    <label className="cp-setting cp-look">
      <span>
        <strong>Keep the same look</strong>
        <small>
          {keeping
            ? "New renders stay close to the one you chose. Change the prompt or a setting to refine it — changing nothing repeats it."
            : canKeep
              ? "Off: every render is a fresh take. Turn on to refine the render you're viewing."
              : "Off: every render is a fresh take. Generate a render, then turn this on to refine it."}
        </small>
      </span>
      <span className="cp-switch">
        <input
          type="checkbox"
          checked={keeping}
          disabled={!canKeep}
          onChange={(event) => setSeed(event.target.checked ? viewedSeed : null)}
        />
        <span aria-hidden="true" />
      </span>
    </label>
  );
}
