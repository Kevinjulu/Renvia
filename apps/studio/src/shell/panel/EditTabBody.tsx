import { useEffect } from "react";
import { thumbnailUrl, MAX_EDIT_REFERENCE_NOTE_CHARS, MAX_EDIT_REFERENCES, type EditMethod, type EditReference, type EditReferenceTarget } from "@renvia/types";
import { ReferenceBar } from "./ReferenceBar";
import { AdvancedSection } from "./AdvancedSection";
import { ENVIRONMENT_CONTROLS, environmentLabels } from "./editEnvironmentOptions";
import { hasSelection, startRenderEdit, useRenderEditStore } from "../../canvas/hooks/useRenderEditStore";
import { STYLE_INFLUENCE_LABELS, useGenerationSettingsStore, type EditScope } from "../../canvas/hooks/useGenerationSettingsStore";
import { useEditDraft } from "../../canvas/hooks/useEditDraft";
import { useAccountStore } from "../../lib/useAccountStore";
import { PromptAssist } from "./PromptAssist";

/** Server default before /me has loaded — matches app_settings.max_prompt_chars's default. */
const DEFAULT_MAX_PROMPT_CHARS = 1000;

const METHODS: { id: EditMethod; label: string; hint: string }[] = [
  { id: "prompt", label: "Describe", hint: "Type the change you want." },
  { id: "reference", label: "Reference", hint: "The render takes on the look of your reference images." },
  { id: "reference-prompt", label: "Both", hint: "References, plus what to take from them." },
];

/** What a reference can be for, in the order people reach for them most. */
const REFERENCE_TARGETS: { id: EditReferenceTarget; label: string; part: string }[] = [
  { id: "look", label: "Overall look", part: "the overall look" },
  { id: "roof", label: "Roof", part: "the roof" },
  { id: "walls", label: "Walls", part: "the walls" },
  { id: "paving", label: "Paving / cabro", part: "the paving" },
  { id: "windows", label: "Windows", part: "the windows" },
  { id: "doors", label: "Doors", part: "the doors" },
  { id: "columns", label: "Pillars", part: "the pillars" },
  { id: "railings", label: "Railings", part: "the railings" },
  { id: "garden", label: "Garden", part: "the garden" },
  { id: "other", label: "Something else", part: "" },
];

/** "the roof", "the paving", or the person's own words for "Something else". */
function referencePart(reference: EditReference): string {
  if (reference.target === "other") return reference.note?.trim() || "something else";
  return REFERENCE_TARGETS.find((item) => item.id === reference.target)?.part ?? "the overall look";
}

/** True when the references say more than "one image, its whole look". */
function isTagged(references: EditReference[]): boolean {
  return references.length > 1 || references.some((reference) => reference.target !== "look");
}

const SCOPES: { id: EditScope; label: string }[] = [
  { id: "whole", label: "Whole image" },
  { id: "selection", label: "Selected area" },
];

/** One-tap instructions for "Both": the parts people most often borrow from a reference. */
const PARTS: { label: string; prompt: string }[] = [
  { label: "Windows", prompt: "Make the windows match the reference" },
  { label: "Roof", prompt: "Make the roof match the reference" },
  { label: "Doors", prompt: "Make the doors match the reference" },
  { label: "Pillars", prompt: "Make the pillars match the reference" },
  { label: "Outdoors", prompt: "Make the garden and outdoor areas match the reference" },
  { label: "Exterior", prompt: "Make the exterior design match the reference" },
];

const SUN_ICON = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="2.8" />
    <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
  </svg>
);

const quoted = (text: string) => `“${text}”`;
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "a", "a and b", "a, b and c". */
function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** The selection as tagged, e.g. "the front door and the window"; null when nothing is tagged. */
function namedSelection(labels: string[]): string | null {
  return labels.length > 0 ? joinList(labels.map((label) => `the ${label.toLowerCase()}`)) : null;
}

/** The selected-area badge: "Front door and window selected — only these change". */
function selectionBadge(labels: string[], areaCount: number): string {
  const several = areaCount > 1;
  if (labels.length > 0) return `${capitalize(joinList(labels.map((label) => label.toLowerCase())))} selected — only ${several ? "these change" : "it changes"}`;
  return several ? `${areaCount} areas selected — only they change` : "Area selected — only it changes";
}

/** What Apply will do, in plain words, so nobody has to work it out from the controls. */
function summaryLines(
  method: EditMethod,
  prompt: string,
  hasArea: boolean,
  environment: string[],
  labels: string[],
  areaCount: number,
  references: EditReference[],
): string[] {
  const named = namedSelection(labels);
  const several = areaCount > 1;
  const where = hasArea ? (named ? ` on ${named} only` : several ? " in the selected areas" : " in the selected area") : "";
  const parts = [...new Set(references.map(referencePart))];
  const tagged = isTagged(references);
  const main = (() => {
    if (method === "reference" && tagged) {
      return `Each reference is applied to its own part: ${joinList(parts)}${where}.`;
    }
    if (method === "reference") {
      if (!hasArea) return "The render takes on the reference's materials and colours.";
      const subject = named ? capitalize(named) : several ? "The selected areas" : "The selected area";
      return `${subject} ${several ? "take" : "takes"} on the reference's design.`;
    }
    if (!prompt) return null;
    if (method !== "reference-prompt") return `${quoted(prompt)}${where}.`;
    return tagged ? `${quoted(prompt)}, using the references for ${joinList(parts)}${where}.` : `${quoted(prompt)}, using the reference${where}.`;
  })();
  const scene = environment.length > 0 ? `${main ? "Then, over" : "Over"} the whole image: ${environment.join(", ").toLowerCase()}.` : null;
  return [main, scene].filter((line): line is string => line !== null);
}

interface EditTabBodyProps {
  /** A finished render for this view that isn't currently open in the render editor. */
  pendingRenderJobId?: string | null;
}

export function EditTabBody({ pendingRenderJobId = null }: EditTabBodyProps) {
  const method = useGenerationSettingsStore((state) => state.editMethod);
  const setMethod = useGenerationSettingsStore((state) => state.setEditMethod);
  const editPrompt = useGenerationSettingsStore((state) => state.editPrompt);
  const setEditPrompt = useGenerationSettingsStore((state) => state.setEditPrompt);
  const editReferences = useGenerationSettingsStore((state) => state.editReferences);
  const setReferenceUrls = useGenerationSettingsStore((state) => state.setEditReferenceUrls);
  const updateReference = useGenerationSettingsStore((state) => state.updateEditReference);
  const scope = useGenerationSettingsStore((state) => state.editScope);
  const setScope = useGenerationSettingsStore((state) => state.setEditScope);
  const environment = useGenerationSettingsStore((state) => state.editEnvironment);
  const setEnvironment = useGenerationSettingsStore((state) => state.setEditEnvironment);
  const editInfluence = useGenerationSettingsStore((state) => state.editInfluence);
  const setEditInfluence = useGenerationSettingsStore((state) => state.setEditInfluence);
  const me = useAccountStore((state) => state.me);

  const isEditingRender = useRenderEditStore((state) => state.targetJobId !== null);
  const areaPainted = useRenderEditStore((state) => hasSelection(state.strokes));
  const clearStrokes = useRenderEditStore((state) => state.clearStrokes);
  const draft = useEditDraft();

  // Painting on the render is a clear sign the edit is meant for that area.
  useEffect(() => {
    if (areaPainted) setScope("selection");
  }, [areaPainted, setScope]);

  if (!isEditingRender) {
    return (
      <div className="cp-tab-body">
        {pendingRenderJobId ? (
          <div className="cp-hint cp-hint-action">
            <p>Edits change a finished render. Open this view's latest render to start.</p>
            <button type="button" className="cp-hint-button" onClick={() => startRenderEdit(pendingRenderJobId)}>
              Edit this render
            </button>
          </div>
        ) : (
          <p className="cp-hint">Edits change a finished render. Generate one in the Render tab, then come back here to refine it.</p>
        )}
      </div>
    );
  }

  const maxChars = me?.limits.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS;
  const environmentPicked = environmentLabels(environment);
  const summary = summaryLines(method, draft.prompt, draft.hasArea, environmentPicked, draft.selectionLabels, draft.areaCount, draft.referenceTags);
  // The plan's own reference limit, never past what an edit can take.
  const maxReferences = Math.max(1, Math.min(MAX_EDIT_REFERENCES, me?.limits.maxReferenceImages ?? MAX_EDIT_REFERENCES));
  const showPrompt = method !== "reference";

  return (
    <div className="cp-tab-body">
      <section className="cp-edit-step">
        <span className="cp-edit-label" id="edit-method-label">How do you want to edit?</span>
        <div className="cp-segmented" role="group" aria-labelledby="edit-method-label">
          {METHODS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={method === item.id ? "is-active" : ""}
              aria-pressed={method === item.id}
              onClick={() => setMethod(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <small className="cp-edit-caption">{METHODS.find((item) => item.id === method)?.hint}</small>
      </section>

      {method !== "prompt" && (
        <section className="cp-card cp-references">
          <div className="cp-card-head">
            <strong>Reference images</strong>
            <span>
              {maxReferences > 1
                ? `Up to ${maxReferences}: a house you like, a roof tile, a wall texture, a cabro pattern…`
                : "One image: its look guides the edit"}
            </span>
          </div>
          <ReferenceBar
            urls={editReferences.map((reference) => reference.url)}
            onChange={setReferenceUrls}
            maxReferences={maxReferences}
            atCapHint={`Edits take up to ${maxReferences} ${maxReferences === 1 ? "reference" : "references"}. Remove one to add another`}
          />
          {editReferences.length > 0 && (
            <div className="cp-ref-tags" role="group" aria-label="What each reference is for">
              <span className="cp-ref-tags-title">What is each one for?</span>
              {editReferences.map((reference, index) => (
                <div key={reference.url} className="cp-ref-tag">
                  <img src={thumbnailUrl(reference.url)} alt="" />
                  <div className="cp-ref-tag-fields">
                    <select
                      aria-label={`Reference ${index + 1} is for`}
                      value={reference.target}
                      onChange={(event) => updateReference(reference.url, { target: event.target.value as EditReferenceTarget })}
                    >
                      {REFERENCE_TARGETS.map((target) => (
                        <option key={target.id} value={target.id}>
                          {target.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      aria-label={`Note for reference ${index + 1}`}
                      value={reference.note}
                      maxLength={MAX_EDIT_REFERENCE_NOTE_CHARS}
                      onChange={(event) => updateReference(reference.url, { note: event.target.value })}
                      placeholder={reference.target === "other" ? "What is it for? e.g. the gate" : "Optional note, e.g. only the grey tiles"}
                      aria-invalid={reference.target === "other" && !reference.note.trim()}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {showPrompt && (
        <div className="cp-prompt">
          <div className="cp-prompt-head">
            <label htmlFor="edit-prompt">
              {method === "reference-prompt"
                ? editReferences.length > 1
                  ? "What should it take from the references?"
                  : "What should it take from the reference?"
                : "Describe the change"}
            </label>
            <span>
              {editPrompt.length}/{maxChars}
            </span>
          </div>
          {method === "reference-prompt" && (
            <div className="cp-chips is-wrap" role="group" aria-label="Quick picks">
              {PARTS.map((part) => (
                <button
                  key={part.label}
                  type="button"
                  className={editPrompt === part.prompt ? "is-active" : ""}
                  aria-pressed={editPrompt === part.prompt}
                  onClick={() => setEditPrompt(part.prompt)}
                >
                  {part.label}
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
              method === "reference-prompt" ? "e.g. Make the windows match the reference" : "e.g. Replace the front door with a dark oak pivot door"
            }
          />
          <PromptAssist prompt={editPrompt} kind="edit" inputId="edit-prompt" onUse={(value) => setEditPrompt(value.slice(0, maxChars))} />
        </div>
      )}

      <section className="cp-edit-step">
        <span className="cp-edit-label" id="edit-scope-label">Apply to</span>
        <div className="cp-segmented" role="group" aria-labelledby="edit-scope-label">
          {SCOPES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={scope === item.id ? "is-active" : ""}
              aria-pressed={scope === item.id}
              onClick={() => setScope(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {scope === "selection" &&
          (areaPainted ? (
            <div className="cp-prompt-tag">
              <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2.5h4L10 6.5l-3.5 3.5L2.5 6.5Z" /><circle cx="4.2" cy="4.2" r="0.7" fill="currentColor" stroke="none" /></svg>
              <span>{selectionBadge(draft.selectionLabels, draft.areaCount)}</span>
              <button type="button" aria-label="Clear the selected area" onClick={clearStrokes}>
                <svg viewBox="0 0 10 10" aria-hidden="true"><path d="m2 2 6 6M8 2 2 8" /></svg>
              </button>
            </div>
          ) : (
            <small className="cp-edit-caption">Pick a tool on the render and mark the part to change.</small>
          ))}
      </section>

      <AdvancedSection
        title="Environment"
        storageKey="renvia.panel.environmentOpen"
        icon={SUN_ICON}
        summary={environmentPicked.length > 0 ? environmentPicked.join(" · ") : "Optional — time of day, season, weather, facade"}
      >
        <p className="cp-edit-caption">Applied over the whole image, after any area edit.</p>
        <div className="cp-env-rows">
          {ENVIRONMENT_CONTROLS.map((control) => (
            <label key={control.key} className="cp-env-row">
              <span>{control.label}</span>
              <select
                value={environment[control.key] ?? ""}
                onChange={(event) => setEnvironment(control.key, event.target.value || undefined)}
              >
                <option value="">Keep as is</option>
                {control.options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </AdvancedSection>

      {summary.length > 0 && (
        <div className="cp-edit-summary" role="status">
          <strong>What will happen</strong>
          {summary.map((line, index) => (
            <p key={line}>
              {summary.length > 1 && <b>{index + 1}</b>}
              {line}
            </p>
          ))}
        </div>
      )}

      <AdvancedSection summary={`${STYLE_INFLUENCE_LABELS[editInfluence - 1]} strength`}>
        <label className="cp-setting is-stacked" data-guide="control.influence">
          <span>
            <strong>Edit strength</strong>
            <small>How far the change may depart from the current image</small>
          </span>
          <span className="cp-range">
            <input type="range" min="1" max="4" value={editInfluence} onChange={(event) => setEditInfluence(Number(event.target.value))} />
            <b>{STYLE_INFLUENCE_LABELS[editInfluence - 1]}</b>
          </span>
        </label>
      </AdvancedSection>
    </div>
  );
}
