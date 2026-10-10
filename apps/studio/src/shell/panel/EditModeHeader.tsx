import type { RenderJob } from "@renvia/types";
import { useRenderJobsStore } from "../../canvas/hooks/useRenderJobsStore";

/** Top of the Edit tab: names the render open in the viewer, the only thing an edit changes. */
export function EditModeHeader({ render }: { render: RenderJob }) {
  const setPreviewJob = useRenderJobsStore((state) => state.setPreviewJob);
  if (!render.resultImageUrl) return null;

  return (
    <div className="edit-target-card">
      <button type="button" className="edit-target-thumb" title="View this render full size" onClick={() => setPreviewJob(render.id)}>
        <img src={render.resultImageUrl} alt="" />
      </button>
      <div>
        <p>Editing a render</p>
        <strong>{[render.settings?.edit ? "Edit" : "Render", render.viewLabel].filter(Boolean).join(" · ")}</strong>
        <small>To edit a different render, open it from the results panel and choose Edit.</small>
      </div>
    </div>
  );
}
