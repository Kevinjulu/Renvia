import { useEffect } from "react";
import { ReferenceBar } from "./ReferenceBar";
import { KeepLookControl } from "./KeepLookControl";
import { AdvancedSection } from "./AdvancedSection";
import { hasSelection, startRenderEdit, useRenderEditStore } from "../../canvas/hooks/useRenderEditStore";
import {
  STYLE_INFLUENCE_LABELS,
  inferEditMode,
  useGenerationSettingsStore,
  type EditAction,
  type EditMode,
} from "../../canvas/hooks/useGenerationSettingsStore";
import { useAccountStore } from "../../lib/useAccountStore";

const ACTIONS: { id: EditAction; label: string }[] = [
  { id: "add", label: "Add" },
  { id: "remove", label: "Remove" },
  { id: "change", label: "Change" },
];

/** Server default before /me has loaded — matches app_settings.max_prompt_chars's default. */
const DEFAULT_MAX_PROMPT_CHARS = 2000;

/** What the edit will do, in one line, so the panel needn't ask for a mode up front. */
function modeSentence(hasReferences: boolean, mode: EditMode, hasArea: boolean): string {
  if (hasReferences) {
    return mode === "building"
      ? "The reference restyles the whole building."
      : "The reference sets the material and colour of the selected area.";
  }
  return hasArea
    ? "Your description is applied to the selected area only."
    : "Your description is applied to the whole image — paint an area to limit it.";
}

interface EditTabBodyProps {
  /** A finished render for this view that isn't currently open in the render editor. */
  pendingRenderJobId?: string | null;
}

export function EditTabBody({ pendingRenderJobId = null }: EditTabBodyProps) {
  const editMode = useGenerationSettingsStore((state) => state.editMode);
  const applyInferredEditMode = useGenerationSettingsStore((state) => state.applyInferredEditMode);
  const editAction = useGenerationSettingsStore((state) => state.editAction);
  const setEditAction = useGenerationSettingsStore((state) => state.setEditAction);
  const editPrompt = useGenerationSettingsStore((state) => state.editPrompt);
  const setEditPrompt = useGenerationSettingsStore((state) => state.setEditPrompt);
  const editInfluence = useGenerationSettingsStore((state) => state.editInfluence);
  const setEditInfluence = useGenerationSettingsStore((state) => state.setEditInfluence);
  const referenceCount = useGenerationSettingsStore((state) => state.referenceImageUrls.length);
  const seed = useGenerationSettingsStore((state) => state.seed);
  const me = useAccountStore((state) => state.me);

  const editTargetJobId = useRenderEditStore((state) => state.targetJobId);
  const isEditingRender = editTargetJobId !== null;
  const renderAreaSelected = useRenderEditStore((state) => hasSelection(state.strokes));
  const clearStrokes = useRenderEditStore((state) => state.clearStrokes);

  // A manual area can only be painted on a render open in the viewer.
  const manualAreaSelected = isEditingRender && renderAreaSelected;
  const hasReferences = referenceCount > 0;

  // What the prompt is scoped to, shown as a tag on "Describe the change" so it's never
  // ambiguous what a typed description will apply to.
  const targetTag = manualAreaSelected ? { label: "Selected area", onClear: clearStrokes } : null;

  // The mode follows the inputs unless the user has overridden it.
  useEffect(() => {
    applyInferredEditMode(inferEditMode({ hasReferences, hasSelection: manualAreaSelected, hasAction: editAction !== null }));
  }, [hasReferences, manualAreaSelected, editAction, applyInferredEditMode]);

  const maxChars = me?.limits.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS;

  return (
    <div className="cp-tab-body">
      {isEditingRender ? (
        <p className="cp-hint">
          Optional: paint the part you want to change — brush, rectangle, polygon, or click an object in the viewer.
          Leave it unpainted to edit the whole image.
        </p>
      ) : pendingRenderJobId ? (
        <div className="cp-hint cp-hint-action">
          <p>This view already has a render — edit that, not the original upload.</p>
          <button type="button" className="cp-hint-button" onClick={() => startRenderEdit(pendingRenderJobId)}>
            Edit this render
          </button>
        </div>
      ) : (
        <p className="cp-hint">Nothing rendered yet, so a change applies to your uploaded elevation. Render first to edit the result.</p>
      )}

      <div className="cp-prompt">
        <div className="cp-prompt-head">
          <label htmlFor="edit-prompt">Describe the change</label>
          <span>
            {editPrompt.length}/{maxChars}
          </span>
        </div>
        {targetTag && (
          <div className="cp-prompt-tag">
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2.5h4L10 6.5l-3.5 3.5L2.5 6.5Z" /><circle cx="4.2" cy="4.2" r="0.7" fill="currentColor" stroke="none" /></svg>
            <span>Editing: {targetTag.label}</span>
            {targetTag.onClear && (
              <button type="button" aria-label={`Stop editing ${targetTag.label.toLowerCase()}`} onClick={targetTag.onClear}>
                <svg viewBox="0 0 10 10" aria-hidden="true"><path d="m2 2 6 6M8 2 2 8" /></svg>
              </button>
            )}
          </div>
        )}
        {!hasReferences && (
          <div className="cp-segmented is-small is-actions" role="group" aria-label="Edit action">
            {ACTIONS.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={() => setEditAction(editAction === action.id ? null : action.id)}
                aria-pressed={editAction === action.id}
                className={editAction === action.id ? "is-active" : ""}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
        <textarea
          id="edit-prompt"
          value={editPrompt}
          onChange={(event) => setEditPrompt(event.target.value.slice(0, maxChars))}
          maxLength={maxChars}
          placeholder={manualAreaSelected ? "Describe the change for the selected area…" : "Describe the change you want…"}
        />
      </div>

      <section className="cp-card cp-references">
        <div className="cp-card-head">
          <strong>Reference images</strong>
          <span>Borrow a material or look</span>
        </div>
        <ReferenceBar />
      </section>

      <p className="cp-ai-note">{modeSentence(hasReferences, editMode, manualAreaSelected)}</p>

      <AdvancedSection summary={`${STYLE_INFLUENCE_LABELS[editInfluence - 1]} strength · ${seed === null ? "Fresh takes" : "Keeping a look"}`}>
        <label className="cp-setting is-stacked" data-guide="control.influence">
          <span>
            <strong>Edit strength</strong>
            <small>How far the change may depart from the current image</small>
          </span>
          <span className="cp-range">
            <input
              type="range"
              min="1"
              max="4"
              value={editInfluence}
              onChange={(event) => setEditInfluence(Number(event.target.value))}
            />
            <b>{STYLE_INFLUENCE_LABELS[editInfluence - 1]}</b>
          </span>
        </label>
        <KeepLookControl />
      </AdvancedSection>
    </div>
  );
}
