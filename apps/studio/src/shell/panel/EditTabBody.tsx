import { ReferenceBar } from "./ReferenceBar";
import { SeedControl } from "./SeedControl";
import { hasSelection, useRenderEditStore } from "../../canvas/hooks/useRenderEditStore";
import {
  STYLE_INFLUENCE_LABELS,
  useGenerationSettingsStore,
  type EditAction,
  type EditMode,
  type SelectionMode,
} from "../../canvas/hooks/useGenerationSettingsStore";
import { useAccountStore } from "../../lib/useAccountStore";
import { viewImage } from "../../canvas/utils/viewImage";
import { GuideLabel } from "../../guide/HelpHotspot";

const EDIT_MODES: { id: EditMode; icon: string; title: string; subtitle: string }[] = [
  { id: "element", icon: "◫", title: "Element / texture", subtitle: "Borrow a finish or material" },
  { id: "building", icon: "▧", title: "Whole building", subtitle: "Reference architectural style" },
  { id: "prompt", icon: "✦", title: "Prompt edit", subtitle: "Describe the transformation" },
];

const ACTIONS: { id: EditAction; label: string }[] = [
  { id: "add", label: "Add" },
  { id: "remove", label: "Remove" },
  { id: "change", label: "Change" },
];

const SELECTION_MODES: { id: SelectionMode; label: string }[] = [
  { id: "auto", label: "Auto select" },
  { id: "manual", label: "Manual" },
];

/** Server default before /me has loaded — matches app_settings.max_prompt_chars's default. */
const DEFAULT_MAX_PROMPT_CHARS = 2000;
/** Matches app_settings.max_selection_prompt_chars's default. */
const DEFAULT_MAX_SELECTION_CHARS = 200;

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
  const editInfluence = useGenerationSettingsStore((state) => state.editInfluence);
  const setEditInfluence = useGenerationSettingsStore((state) => state.setEditInfluence);
  const me = useAccountStore((state) => state.me);

  const isEditingRender = useRenderEditStore((state) => state.targetJobId !== null);
  const renderAreaSelected = useRenderEditStore((state) => hasSelection(state.strokes));
  const showImageChip = Boolean(currentImageUrl);

  // The edit prompt doubles as the auto-select query when that's the active selection mode,
  // so the true limit is whichever cap is tighter — send more than the segmentation endpoint
  // allows and the request bounces even though the edit prompt itself was within range.
  const maxPromptChars = me?.limits.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS;
  const maxSelectionChars = me?.limits.maxSelectionPromptChars ?? DEFAULT_MAX_SELECTION_CHARS;
  const maxChars = selectionMode === "auto" ? Math.min(maxPromptChars, maxSelectionChars) : maxPromptChars;

  return (
    <div className="edit-panel-body flex flex-1 flex-col">
      <div className="edit-mode-cards" data-guide="edit.modes">
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

      <div className="selection-mode" data-guide="edit.selection">
        <GuideLabel topicId="edit.selection">Selection mode</GuideLabel>
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
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-1 flex-col rounded-lg border border-hairline">
        {showImageChip && (
          <div className="w-fit p-2.5 pb-0">
            <button
              type="button"
              title="View this image full size"
              onClick={() => viewImage(currentImageUrl, "Image being edited")}
              className="block overflow-hidden rounded-md border border-transparent transition-colors hover:border-blueprint"
            >
              <img src={currentImageUrl!} alt="" className="h-20 w-20 object-cover" />
            </button>
          </div>
        )}

        <div className="flex items-center justify-between px-3 pt-2.5">
          <span className="text-xs font-medium text-muted">Prompt</span>
          <span className="text-[11px] text-faint">
            {editPrompt.length}/{maxChars}
          </span>
        </div>
        <textarea
          value={editPrompt}
          onChange={(event) => setEditPrompt(event.target.value.slice(0, maxChars))}
          maxLength={maxChars}
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

      <label className="studio-influence-control" data-guide="control.influence">
        <strong>Edit strength</strong>
        <div>
          <input
            type="range"
            min="1"
            max="4"
            value={editInfluence}
            onChange={(event) => setEditInfluence(Number(event.target.value))}
          />
          <b>{STYLE_INFLUENCE_LABELS[editInfluence - 1]}</b>
        </div>
      </label>

      <SeedControl />

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
