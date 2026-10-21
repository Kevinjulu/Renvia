import { useEffect, useState } from "react";
import { suggestedEditPartForPrompt } from "@renvia/types";
import { ReferenceBar } from "./ReferenceBar";
import { useGenerationSettingsStore } from "../../canvas/hooks/useGenerationSettingsStore";
import { useAccountStore } from "../../lib/useAccountStore";
import { NextStepCallout, nextStepClass, useNextStepHint } from "../../guide/NextStepHint";
import { PromptAssist } from "./PromptAssist";

/** Server defaults before /me has loaded — match app_settings's defaults. */
const DEFAULT_MAX_PROMPT_CHARS = 1000;
const DEFAULT_MAX_REFERENCES = 8;
const FIDELITY_TOAST_STORAGE_KEY = "renvia:fidelity-feature-toast:v1";

interface RenderTabBodyProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  onMoveToEdit: () => void;
}

export function RenderTabBody({ prompt, onPromptChange, onMoveToEdit }: RenderTabBodyProps) {
  const [showFidelityToast, setShowFidelityToast] = useState(false);
  const referenceImageUrls = useGenerationSettingsStore((state) => state.referenceImageUrls);
  const setReferenceImageUrls = useGenerationSettingsStore((state) => state.setReferenceImageUrls);
  const referenceCount = referenceImageUrls.length;
  const suggestReference = useNextStepHint() === "reference";
  const me = useAccountStore((state) => state.me);
  const maxPromptChars = me?.limits.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS;
  const maxReferences = me?.limits.maxReferenceImages ?? DEFAULT_MAX_REFERENCES;
  const suggestedEditPart = suggestedEditPartForPrompt(prompt);

  // Announce the new source-fidelity tools at the moment they matter, once per browser.
  // Storage failures (private mode, quota) should never prevent someone from rendering.
  useEffect(() => {
    if (referenceCount === 0) return;
    try {
      if (localStorage.getItem(FIDELITY_TOAST_STORAGE_KEY) === "1") return;
      localStorage.setItem(FIDELITY_TOAST_STORAGE_KEY, "1");
      setShowFidelityToast(true);
    } catch {
      setShowFidelityToast(true);
    }
  }, [referenceCount]);

  return (
    <div className="cp-tab-body">
      <div className="cp-direction" data-guide="control.direction">
        {showFidelityToast && (
          <div className="cp-feature-toast" role="status" aria-live="polite">
            <div>
              <strong>New: strict source fidelity</strong>
              <span>References can now guide finishes while your roof, openings, massing and camera stay protected.</span>
            </div>
            <button type="button" aria-label="Dismiss source fidelity announcement" onClick={() => setShowFidelityToast(false)}>×</button>
          </div>
        )}
        <div className="cp-prompt">
          <div className="cp-prompt-head">
            <label htmlFor="render-prompt">
              Prompt <span>{referenceCount > 0 ? "optional" : "or add a reference"}</span>
            </label>
            <span>
              {prompt.length}/{maxPromptChars}
            </span>
          </div>
          <textarea
            id="render-prompt"
            value={prompt}
            onChange={(event) => {
              onPromptChange(event.target.value.slice(0, maxPromptChars));
            }}
            maxLength={maxPromptChars}
            placeholder="A modern house with wood cladding by the Swedish coast, surrounded by pine trees"
          />
          {suggestedEditPart && (
            <div className="cp-notice cp-hint-action">
              <p>This is a change to {suggestedEditPart}, not a full render brief. Edit only that area and keep the house intact.</p>
              <button type="button" className="cp-hint-button" onClick={onMoveToEdit}>Edit {suggestedEditPart}</button>
            </div>
          )}
          <PromptAssist prompt={prompt} kind="render" inputId="render-prompt" sourceLocked={referenceCount > 0} onUse={onPromptChange} />
        </div>

        {suggestReference && <NextStepCallout step="reference" />}
        <section className={`cp-card cp-references ${nextStepClass(suggestReference)}`}>
          <div className="cp-card-head">
            <strong>Reference images</strong>
            <span>Guides materials, light and setting</span>
          </div>
          <ReferenceBar urls={referenceImageUrls} onChange={setReferenceImageUrls} maxReferences={maxReferences} />
        </section>
      </div>
    </div>
  );
}
