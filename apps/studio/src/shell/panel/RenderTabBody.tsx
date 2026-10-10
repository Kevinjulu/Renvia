import { useEffect, useState } from "react";
import { suggestedEditPartForPrompt, type ProtectedGeometryFeature, type PromptRepairResponse } from "@renvia/types";
import { ReferenceBar } from "./ReferenceBar";
import { STYLE_INFLUENCE_LABELS, useGenerationSettingsStore } from "../../canvas/hooks/useGenerationSettingsStore";
import { useAccountStore } from "../../lib/useAccountStore";
import { KeepLookControl } from "./KeepLookControl";
import { AdvancedSection } from "./AdvancedSection";
import { GuideLabel } from "../../guide/HelpHotspot";
import { useApiClient } from "../../lib/apiClient";

/** Server defaults before /me has loaded — match app_settings's defaults. */
const DEFAULT_MAX_PROMPT_CHARS = 2000;
const DEFAULT_MAX_REFERENCES = 8;
const FIDELITY_TOAST_STORAGE_KEY = "renvia:fidelity-feature-toast:v1";

interface RenderTabBodyProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  onMoveToEdit: () => void;
}

const PROTECTED_FEATURES: { id: ProtectedGeometryFeature; label: string }[] = [
  { id: "silhouette", label: "Silhouette" },
  { id: "roof", label: "Roof" },
  { id: "openings", label: "Openings" },
  { id: "massing", label: "Massing" },
  { id: "camera", label: "Camera" },
];

export function RenderTabBody({ prompt, onPromptChange, onMoveToEdit }: RenderTabBodyProps) {
  const apiClient = useApiClient();
  const [repair, setRepair] = useState<PromptRepairResponse | null>(null);
  const [isRepairing, setIsRepairing] = useState(false);
  const [showFidelityToast, setShowFidelityToast] = useState(false);
  const styleInfluence = useGenerationSettingsStore((state) => state.styleInfluence);
  const setStyleInfluence = useGenerationSettingsStore((state) => state.setStyleInfluence);
  const preserveStructure = useGenerationSettingsStore((state) => state.preserveStructure);
  const setPreserveStructure = useGenerationSettingsStore((state) => state.setPreserveStructure);
  const fidelityMode = useGenerationSettingsStore((state) => state.fidelityMode);
  const setFidelityMode = useGenerationSettingsStore((state) => state.setFidelityMode);
  const protectedGeometry = useGenerationSettingsStore((state) => state.protectedGeometry);
  const setProtectedGeometry = useGenerationSettingsStore((state) => state.setProtectedGeometry);
  const geometryReviewedAt = useGenerationSettingsStore((state) => state.geometryReviewedAt);
  const confirmGeometryReview = useGenerationSettingsStore((state) => state.confirmGeometryReview);
  const referenceImageUrls = useGenerationSettingsStore((state) => state.referenceImageUrls);
  const setReferenceImageUrls = useGenerationSettingsStore((state) => state.setReferenceImageUrls);
  const referenceCount = referenceImageUrls.length;
  const seed = useGenerationSettingsStore((state) => state.seed);
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

  const polishPrompt = async () => {
    setIsRepairing(true);
    try {
      setRepair(await apiClient.repairPrompt(prompt, referenceCount > 0));
    } finally {
      setIsRepairing(false);
    }
  };

  const toggleProtectedFeature = (feature: ProtectedGeometryFeature) => {
    setProtectedGeometry(
      protectedGeometry.includes(feature)
        ? protectedGeometry.filter((item) => item !== feature)
        : [...protectedGeometry, feature],
    );
  };

  const advancedSummary = [
    `${STYLE_INFLUENCE_LABELS[styleInfluence - 1]} influence`,
    referenceCount > 0 ? "Reference structure lock" : preserveStructure ? "Structure kept" : "Loose structure",
    seed === null ? "Fresh takes" : "Keeping a look",
  ].join(" · ");

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
              Prompt <span>optional</span>
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
          <div className="cp-prompt-tools">
            <button type="button" className="cp-prompt-polish" onClick={() => void polishPrompt()} disabled={isRepairing || !prompt.trim()}>
              {isRepairing ? "Polishing…" : "Polish prompt"}
            </button>
            <small>{referenceCount > 0 ? "Removes reference instructions that would redesign your source." : "Cleans up a short rendering brief."}</small>
          </div>
          {repair && (
            <div className="cp-prompt-repair" role="status">
              {repair.blocked.length > 0 && <p>Kept out: {repair.blocked.join(" · ")}</p>}
              {repair.prompt && <p>Ready to use: {repair.prompt}</p>}
              <div>
                <button
                  type="button"
                  disabled={!repair.prompt || repair.prompt === prompt}
                  onClick={() => {
                    onPromptChange(repair.prompt);
                    setRepair(null);
                  }}
                >
                  Use polished prompt
                </button>
                <button type="button" onClick={() => setRepair(null)}>Dismiss</button>
              </div>
            </div>
          )}
        </div>

        <section className="cp-card cp-references">
          <div className="cp-card-head">
            <strong>Reference images</strong>
            <span>Guides materials, light and setting</span>
          </div>
          <ReferenceBar urls={referenceImageUrls} onChange={setReferenceImageUrls} maxReferences={maxReferences} />
        </section>
      </div>

      <AdvancedSection summary={advancedSummary}>
        <label className="cp-setting is-stacked" data-guide="control.influence">
          <span>
            <strong>
              <GuideLabel topicId="control.influence">Style influence</GuideLabel>
            </strong>
            <small>How much of the references' look carries over</small>
          </span>
          <span className="cp-range">
            <input
              type="range"
              min="1"
              max="4"
              value={styleInfluence}
              onChange={(event) => setStyleInfluence(Number(event.target.value))}
            />
            <b>{STYLE_INFLUENCE_LABELS[styleInfluence - 1]}</b>
          </span>
        </label>
        <label className="cp-setting" data-guide="control.preserve">
          <span>
            <strong>
              <GuideLabel topicId="control.preserve">Preserve structure</GuideLabel>
            </strong>
            <small>
              {referenceCount > 0
                ? "Locked while references are attached — they can style, never redesign"
                : "Keep windows, roofs and massing as drawn"}
            </small>
          </span>
          <span className="cp-switch">
            <input
              type="checkbox"
              checked={preserveStructure}
              disabled={referenceCount > 0}
              onChange={(event) => setPreserveStructure(event.target.checked)}
            />
            <span aria-hidden="true" />
          </span>
        </label>
        {referenceCount > 0 && (
          <div className="cp-setting is-stacked cp-fidelity">
            <span>
              <strong>Source fidelity</strong>
              <small>Keep the source design fixed while references supply finishes, light and landscape.</small>
            </span>
            <div className="cp-segmented" role="group" aria-label="Source fidelity mode">
              <button type="button" className={fidelityMode === "strict" ? "is-active" : ""} aria-pressed={fidelityMode === "strict"} onClick={() => setFidelityMode("strict")}>Strict</button>
              <button type="button" className={fidelityMode === "standard" ? "is-active" : ""} aria-pressed={fidelityMode === "standard"} onClick={() => setFidelityMode("standard")}>Standard</button>
            </div>
            {fidelityMode === "strict" && (
              <>
                <div className="cp-chips is-wrap" role="group" aria-label="Protected source features">
                  {PROTECTED_FEATURES.map((feature) => (
                    <button key={feature.id} type="button" className={protectedGeometry.includes(feature.id) ? "is-active" : ""} aria-pressed={protectedGeometry.includes(feature.id)} onClick={() => toggleProtectedFeature(feature.id)}>
                      {feature.label}
                    </button>
                  ))}
                </div>
                <button type="button" className="cp-fidelity-review" onClick={confirmGeometryReview}>
                  {geometryReviewedAt ? "Source contract reviewed" : "Review protected source geometry"}
                </button>
              </>
            )}
          </div>
        )}
        <KeepLookControl />
      </AdvancedSection>
    </div>
  );
}
