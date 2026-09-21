import { useEffect, useState } from "react";
import { ReferenceBar } from "./ReferenceBar";
import { SeedControl } from "./SeedControl";
import { AdvancedSection } from "./AdvancedSection";
import { hasSelection, maskStrokeFrom, useRenderEditStore } from "../../canvas/hooks/useRenderEditStore";
import {
  STYLE_INFLUENCE_LABELS,
  inferEditMode,
  useGenerationSettingsStore,
  type EditAction,
  type EditMode,
  type SelectionMode,
} from "../../canvas/hooks/useGenerationSettingsStore";
import { EDIT_PARTS, editPartById, WHOLE_IMAGE } from "../../canvas/editParts";
import { selectPart } from "../../canvas/utils/partSelection";
import { refreshAccount, useAccountStore } from "../../lib/useAccountStore";
import { useApiClient } from "../../lib/apiClient";
import { GuideLabel } from "../../guide/HelpHotspot";

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

/** What the edit will do, in one line, so the panel needn't ask for a mode up front. */
function modeSentence(hasReferences: boolean, mode: EditMode, partLabel: string | null): string {
  if (hasReferences) {
    return mode === "building"
      ? "The reference restyles the whole building."
      : `The reference sets the material and colour of ${partLabel ? `the ${partLabel.toLowerCase()}` : "the selected area"}.`;
  }
  return partLabel
    ? `Your description is applied to the ${partLabel.toLowerCase()} only.`
    : "Your description is applied to the whole image.";
}

interface EditTabBodyProps {
  currentImageUrl: string | null;
}

export function EditTabBody({ currentImageUrl }: EditTabBodyProps) {
  const apiClient = useApiClient();
  const editMode = useGenerationSettingsStore((state) => state.editMode);
  const applyInferredEditMode = useGenerationSettingsStore((state) => state.applyInferredEditMode);
  const editAction = useGenerationSettingsStore((state) => state.editAction);
  const setEditAction = useGenerationSettingsStore((state) => state.setEditAction);
  const selectionMode = useGenerationSettingsStore((state) => state.selectionMode);
  const setSelectionMode = useGenerationSettingsStore((state) => state.setSelectionMode);
  const selectedPart = useGenerationSettingsStore((state) => state.selectedPart);
  const setSelectedPart = useGenerationSettingsStore((state) => state.setSelectedPart);
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
  const addStroke = useRenderEditStore((state) => state.addStroke);
  const clearStrokes = useRenderEditStore((state) => state.clearStrokes);

  const [busyPart, setBusyPart] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const part = editPartById(selectedPart);
  const wholeImage = selectedPart === WHOLE_IMAGE;
  const targeted = selectionMode === "manual" ? renderAreaSelected : Boolean(part);
  const hasReferences = referenceCount > 0;

  // The mode follows the inputs unless the user has overridden it.
  useEffect(() => {
    applyInferredEditMode(inferEditMode({ hasReferences, hasSelection: targeted, hasAction: editAction !== null }));
  }, [hasReferences, targeted, editAction, applyInferredEditMode]);

  // A part chip's own fixed term is what's sent to segmentation now, not this prompt, so
  // the edit prompt only needs the plain prompt cap regardless of selection mode.
  const maxChars = me?.limits.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS;

  const isAdmin = me?.role === "admin";
  const autoDisabled = (() => {
    if (me?.maintenanceSegments && !isAdmin) {
      return me.maintenanceMessage?.trim() || "Automatic selection is paused for maintenance.";
    }
    if (me && !isAdmin && me.creditBalance < 1) return "Out of credits — paint the area by hand instead.";
    return null;
  })();

  const handlePart = async (id: string) => {
    if (busyPart) return;
    if (id === WHOLE_IMAGE) {
      setSelectedPart(selectedPart === WHOLE_IMAGE ? null : WHOLE_IMAGE);
      clearStrokes();
      setNotice(null);
      return;
    }
    const chosen = editPartById(id);
    if (!chosen) return;
    if (selectedPart === id) {
      setSelectedPart(null);
      clearStrokes();
      setNotice(null);
      return;
    }
    setSelectedPart(id);
    setNotice(null);

    // With a render open in the viewer the selection can be shown and adjusted right away;
    // otherwise it's made server-side when the edit is applied, so nothing is spent yet.
    if (!isEditingRender || !currentImageUrl) return;
    if (autoDisabled) {
      setNotice(autoDisabled);
      return;
    }

    setBusyPart(id);
    try {
      const result = await selectPart(apiClient.createSegmentation, currentImageUrl, chosen.term);
      if (!result.cached) void refreshAccount(apiClient.getMe);
      if (!result.maskDataUrl || !result.objectCount) {
        setSelectedPart(null);
        setNotice(`No ${chosen.label.toLowerCase()} found here — your credit was refunded. Paint the area instead.`);
        return;
      }
      clearStrokes();
      addStroke(await maskStrokeFrom(result.maskDataUrl));
      setNotice(
        result.cached
          ? `${chosen.label} selected again — no credit used. Paint or erase to adjust.`
          : `${chosen.label} selected. Paint or erase in the viewer to adjust.`,
      );
    } catch {
      setSelectedPart(null);
      setNotice("Automatic selection failed. Try again, or paint the area by hand.");
    } finally {
      setBusyPart(null);
    }
  };

  return (
    <div className="cp-tab-body">
      <div className="cp-field" data-guide="edit.selection">
        <p className="cp-field-label">
          <GuideLabel topicId="edit.selection">Select the area</GuideLabel>
        </p>
        <div className="cp-segmented" role="group" aria-label="Selection mode">
          {SELECTION_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              className={selectionMode === mode.id ? "is-active" : ""}
              onClick={() => setSelectionMode(mode.id)}
              aria-pressed={selectionMode === mode.id}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      {selectionMode === "auto" ? (
        <div className="cp-field" data-guide="edit.modes">
          <p className="cp-field-label">What do you want to change?</p>
          <div className="cp-chips is-wrap">
            {EDIT_PARTS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={selectedPart === item.id ? "is-active" : ""}
                aria-pressed={selectedPart === item.id}
                disabled={busyPart !== null && busyPart !== item.id}
                onClick={() => void handlePart(item.id)}
              >
                {busyPart === item.id ? "Selecting…" : item.label}
              </button>
            ))}
            <button
              type="button"
              className={`is-dashed ${wholeImage ? "is-active" : ""}`}
              aria-pressed={wholeImage}
              onClick={() => void handlePart(WHOLE_IMAGE)}
            >
              Whole image
            </button>
          </div>
        </div>
      ) : (
        <p className="cp-hint">
          {isEditingRender
            ? "Paint over the part of the render you want to change — brush, rectangle or polygon in the viewer."
            : "Draw a rectangle or polygon on the image — only that area is regenerated."}
        </p>
      )}

      {notice && <p className="cp-notice">{notice}</p>}

      <div className="cp-prompt">
        <div className="cp-prompt-head">
          <label htmlFor="edit-prompt">Describe the change</label>
          <span>
            {editPrompt.length}/{maxChars}
          </span>
        </div>
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
          placeholder={
            part
              ? `Describe the new ${part.label.toLowerCase()} — material, colour, style…`
              : "Describe the change you want…"
          }
        />
      </div>

      <section className="cp-card cp-references">
        <div className="cp-card-head">
          <strong>Reference images</strong>
          <span>Borrow a material or look</span>
        </div>
        <ReferenceBar />
      </section>

      <p className="cp-ai-note">{modeSentence(hasReferences, editMode, part?.label ?? null)}</p>

      <AdvancedSection summary={`${STYLE_INFLUENCE_LABELS[editInfluence - 1]} strength · ${seed === null ? "Random seed" : `Seed ${seed}`}`}>
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
        <SeedControl />
      </AdvancedSection>
    </div>
  );
}
