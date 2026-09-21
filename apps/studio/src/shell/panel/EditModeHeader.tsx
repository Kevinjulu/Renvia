import type { RenderJob } from "@renvia/types";
import { useRenderEditStore } from "../../canvas/hooks/useRenderEditStore";
import { useRenderJobsStore } from "../../canvas/hooks/useRenderJobsStore";
import { viewImage } from "../../canvas/utils/viewImage";

/** Top of the Edit tab: explains the tools, or names the render being edited in the viewer. */
export function EditModeHeader({ render, currentImageUrl }: { render: RenderJob | null; currentImageUrl: string | null }) {
  const stopEditing = useRenderEditStore((state) => state.stopEditing);
  const setPreviewJob = useRenderJobsStore((state) => state.setPreviewJob);

  if (render?.resultImageUrl) {
    return (
      <div className="edit-target-card">
        <button
          type="button"
          className="edit-target-thumb"
          title="View this render full size"
          onClick={() => setPreviewJob(render.id)}
        >
          <img src={render.resultImageUrl} alt="" />
        </button>
        <div>
          <p>Editing a render</p>
          <strong>{[render.settings?.edit ? "Edit" : "Render", render.viewLabel].filter(Boolean).join(" · ")}</strong>
          <small>Paint over the area to change on the image. Your prompt and references only affect that area.</small>
          <button type="button" onClick={stopEditing}>
            Edit the canvas image instead
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="cp-edit-target">
      {currentImageUrl ? (
        <button type="button" title="View this image full size" onClick={() => viewImage(currentImageUrl, "Image being edited")}>
          <img src={currentImageUrl} alt="" />
        </button>
      ) : (
        <span aria-hidden="true">
          <svg viewBox="0 0 18 18"><path d="M11.5 2.5 15 6l-8 8-4 1 1-4Z" /></svg>
        </span>
      )}
      <p>
        <strong>{currentImageUrl ? "Editing the canvas image" : "Nothing to edit yet"}</strong>
        <small>
          {currentImageUrl
            ? "To edit a render instead, open it and choose Edit."
            : "Upload an elevation, or open a render and choose Edit."}
        </small>
      </p>
    </div>
  );
}
