import { ReferenceBar } from "./ReferenceBar";
import { hasSelection, useRenderEditStore } from "../../canvas/hooks/useRenderEditStore";
import {
  useGenerationSettingsStore,
  type EditAction,
  type EditMode,
  type SelectionMode,
} from "../../canvas/hooks/useGenerationSettingsStore";

const EDIT_MODES: { id: EditMode; icon: string; title: string; subtitle: string }[] = [
  { id: "element", icon: "◫", title: "Element / texture", subtitle: "Borrow a finish or material" },
  { id: "building", icon: "▧", title: "Whole building", subtitle: "Reference architectural style" },
  { id: "prompt", icon: "✦", title: "Prompt edit", subtitle: "Describe the transformation" },
];

const ACTIONS: { id: EditAction; label: string; hasMenu?: boolean }[] = [
  { id: "add", label: "Add" },
  { id: "remove", label: "Remove" },
  { id: "change", label: "Change", hasMenu: true },
];

const SELECTION_MODES: { id: SelectionMode; label: string }[] = [
  { id: "auto", label: "Auto select" },
  { id: "manual", label: "Manual" },
];

interface EditTabBodyProps {
  currentImageUrl: string | null;
}

export function EditTabBody({ currentImageUrl }: EditTabBodyProps) {
  const editMode = useGenerationSettingsStore((state) => state.editMode);
  const setEditMode = useGenerationSettingsStore((state) => state.setEditMode);
  const editAction = useGenerationSettingsStore((state) => state.editAction);
  const setEditAction = useGenerationSettingsStore((state) => state.setEditAction);
  const selectionMode = useGenerationSettingsStore((state) => state.selectionMode);
  const setSelectionMode = useGenerationSettingsStore((state) => state.setSelectionMode);
  const editPrompt = useGenerationSettingsStore((state) => state.editPrompt);
  const setEditPrompt = useGenerationSettingsStore((state) => state.setEditPrompt);

  const isEditingRender = useRenderEditStore((state) => state.targetJobId !== null);
  const renderAreaSelected = useRenderEditStore((state) => hasSelection(state.strokes));
  const showImageChip = Boolean(currentImageUrl);

  return (
    <div className="edit-panel-body flex flex-1 flex-col">
      <div className="edit-mode-cards">
        {EDIT_MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            className={editMode === mode.id ? "active" : ""}
            onClick={() => setEditMode(mode.id)}
            aria-pressed={editMode === mode.id}
          >
            <span>{mode.icon}</span>
            <p>
              <strong>{mode.title}</strong>
              <small>{mode.subtitle}</small>
            </p>
          </button>
        ))}
      </div>

      <div className="selection-mode">
        <span>Selection mode</span>
        {SELECTION_MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            className={selectionMode === mode.id ? "active" : ""}
            onClick={() => setSelectionMode(mode.id)}
            aria-pressed={selectionMode === mode.id}
          >
            {mode.label}
          </button>
        ))}
      </div>

      {editMode !== "prompt" && (
        <div className="flex items-center gap-2">
          {ACTIONS.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => setEditAction(editAction === action.id ? null : action.id)}
              aria-pressed={editAction === action.id}
              className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                editAction === action.id
                  ? "border-blueprint bg-blueprint-soft text-blueprint"
                  : "border-hairline text-secondary hover:border-hairline-strong hover:text-primary"
              }`}
            >
              {action.label}
              {action.hasMenu && (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                  <path d="M2.5 4 5 6.5 7.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-1 flex-col rounded-lg border border-hairline">
        {showImageChip && (
          <div className="relative w-fit p-2.5 pb-0">
            <img src={currentImageUrl!} alt="" className="h-20 w-20 rounded-md object-cover" />
            <span className="absolute bottom-1 left-3 flex h-4 w-4 items-center justify-center rounded bg-primary/80 text-[10px] font-medium text-white">
              1
            </span>
          </div>
        )}

        <textarea
          value={editPrompt}
          onChange={(event) => setEditPrompt(event.target.value)}
          maxLength={500}
          placeholder={
            editMode === "prompt"
              ? "Describe the transformation you want…"
              : "Describe your edits…"
          }
          className="min-h-[100px] flex-1 resize-none rounded-lg p-3 text-sm text-primary placeholder:text-faint focus:outline-none"
        />

        <div className="px-3 pb-3">
          <ReferenceBar />
          {isEditingRender && renderAreaSelected && (
            <p className="mt-1.5 text-[11px] text-muted">References only change the area you painted.</p>
          )}
        </div>
      </div>

      <p className="studio-ai-note">
        {isEditingRender
          ? renderAreaSelected
            ? "Only the painted area of the render is regenerated — everything else stays exactly as it is."
            : "Paint over part of the render to change just that area, or apply to edit the whole render."
          : selectionMode === "manual"
            ? "Draw a rectangle or polygon on the image — only that area is regenerated."
            : "The AI finds what to change from your description. Draw a selection to limit the edit to one area."}
      </p>
    </div>
  );
}
