import type { RenderJob } from "@renvia/types";
import { useRenderEditStore } from "../../canvas/hooks/useRenderEditStore";

/** Top of the Edit tab: explains the tools, or names the render being edited in the viewer. */
export function EditModeHeader({ render }: { render: RenderJob | null }) {
  const stopEditing = useRenderEditStore((state) => state.stopEditing);

  if (render?.resultImageUrl) {
    return (
      <div className="edit-target-card">
        <img src={render.resultImageUrl} alt="" />
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
    <div className="flex flex-col items-center px-2 pt-1 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-muted text-secondary">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path
            d="M11.5 2.5 15 6l-8 8-4 1 1-4Z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <h2 className="mt-3 font-display text-base font-semibold text-primary">Editing mode</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">
        Describe the changes you would like to see. To edit a specific part, use the selection tools at the top of
        the canvas to highlight that area. To edit a render, open it and choose Edit.
      </p>
    </div>
  );
}
