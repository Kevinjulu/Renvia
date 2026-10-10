import { useEffect } from "react";
import type { EditMethod } from "@renvia/types";
import { ReferenceBar } from "./ReferenceBar";
import { KeepLookControl } from "./KeepLookControl";
import { AdvancedSection } from "./AdvancedSection";
import { ENVIRONMENT_CONTROLS, environmentLabels } from "./editEnvironmentOptions";
import { hasSelection, startRenderEdit, useRenderEditStore } from "../../canvas/hooks/useRenderEditStore";
import { STYLE_INFLUENCE_LABELS, useGenerationSettingsStore, type EditScope } from "../../canvas/hooks/useGenerationSettingsStore";
import { useEditDraft } from "../../canvas/hooks/useEditDraft";
import { useAccountStore } from "../../lib/useAccountStore";

/** Server default before /me has loaded — matches app_settings.max_prompt_chars's default. */
const DEFAULT_MAX_PROMPT_CHARS = 2000;

const METHODS: { id: EditMethod; label: string; hint: string }[] = [
  { id: "prompt", label: "Describe", hint: "Type the change you want." },
  { id: "reference", label: "Reference", hint: "The render takes on the look of one image." },
  { id: "reference-prompt", label: "Both", hint: "A reference, plus what to take from it." },
];

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

/** What Apply will do, in plain words, so nobody has to work it out from the controls. */
function summaryLines(method: EditMethod, prompt: string, hasArea: boolean, environment: string[]): string[] {
  const where = hasArea ? " in the selected area" : "";
  const main = (() => {
    if (method === "reference") {
      return hasArea ? "The selected area takes on the reference's design." : "The render takes on the reference's materials and colours.";
    }
    if (!prompt) return null;
    return method === "reference-prompt" ? `${quoted(prompt)}, using the reference${where}.` : `${quoted(prompt)}${where}.`;
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
  const referenceUrl = useGenerationSettingsStore((state) => state.editReferenceUrl);
  const setReferenceUrl = useGenerationSettingsStore((state) => state.setEditReferenceUrl);
  const scope = useGenerationSettingsStore((state) => state.editScope);
  const setScope = useGenerationSettingsStore((state) => state.setEditScope);
  const environment = useGenerationSettingsStore((state) => state.editEnvironment);
  const setEnvironment = useGenerationSettingsStore((state) => state.setEditEnvironment);
  const editInfluence = useGenerationSettingsStore((state) => state.editInfluence);
  const setEditInfluence = useGenerationSettingsStore((state) => state.setEditInfluence);
  const seed = useGenerationSettingsStore((state) => state.seed);
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
  const summary = summaryLines(method, draft.prompt, draft.hasArea, environmentPicked);
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
            <strong>Reference image</strong>
            <span>One image works best — its look guides the edit</span>
          </div>
          <ReferenceBar
            urls={referenceUrl ? [referenceUrl] : []}
            onChange={(urls) => setReferenceUrl(urls[0] ?? null)}
            maxReferences={1}
            atCapHint="Edits use one reference — remove it to pick another"
          />
        </section>
      )}

      {showPrompt && (
        <div className="cp-prompt">
          <div className="cp-prompt-head">
            <label htmlFor="edit-prompt">{method === "reference-prompt" ? "What should it take from the reference?" : "Describe the change"}</label>
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
              <span>Area selected — only it changes</span>
              <button type="button" aria-label="Clear the selected area" onClick={clearStrokes}>
                <svg viewBox="0 0 10 10" aria-hidden="true"><path d="m2 2 6 6M8 2 2 8" /></svg>
              </button>
            </div>
          ) : (
            <small className="cp-edit-caption">Paint, draw or click the part to change on the render.</small>
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

      <AdvancedSection summary={`${STYLE_INFLUENCE_LABELS[editInfluence - 1]} strength · ${seed === null ? "Fresh takes" : "Keeping a look"}`}>
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
        <KeepLookControl />
      </AdvancedSection>
    </div>
  );
}
