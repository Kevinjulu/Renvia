import { useState } from "react";
import type { AspectRatio } from "@renvia/types";
import { STYLE_OPTIONS } from "../shell/panel/StylePicker";
import { STYLE_INFLUENCE_LABELS } from "../canvas/hooks/useGenerationSettingsStore";
import {
  DEFAULT_STUDIO_PREFERENCES,
  STUDIO_PREFERENCES_STORAGE_KEY,
  readStudioPreferences,
  writeStudioPreferences,
  type StudioPreferences,
} from "../lib/studioPreferences";
import { useGuideStore } from "../guide/useGuideStore";
import { readGuidePersistence } from "../guide/persistence";

const ASPECT_RATIO_OPTIONS: { id: AspectRatio; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "1:1", label: "1:1" },
  { id: "16:9", label: "16:9" },
  { id: "4:3", label: "4:3" },
  { id: "3:4", label: "3:4" },
  { id: "9:16", label: "9:16" },
];

interface StudioPreferencesSectionProps {
  onSaved: (message: string) => void;
}

export function StudioPreferencesSection({ onSaved }: StudioPreferencesSectionProps) {
  const [prefs, setPrefs] = useState<StudioPreferences>(() => readStudioPreferences());
  const toursCompleted = readGuidePersistence().toursCompleted.length > 0;
  const startTour = useGuideStore((state) => state.startTour);

  const update = (patch: Partial<StudioPreferences>) => {
    setPrefs(writeStudioPreferences(patch));
    onSaved("Saved — applies to your next project or reload.");
  };

  const resetDefaults = () => {
    localStorage.removeItem(STUDIO_PREFERENCES_STORAGE_KEY);
    setPrefs({ ...DEFAULT_STUDIO_PREFERENCES });
    onSaved("Preferences reset to Renvia's defaults.");
  };

  return (
    <div className="studio-prefs">
      <section className="studio-prefs-card">
        <header>
          <h2>Render defaults</h2>
          <p>What a new project starts with — change any of these any time from the panel too.</p>
        </header>

        <div className="studio-prefs-row">
          <span className="studio-prefs-label">
            <strong>Default style</strong>
            <small>Applied to the Render tab on a fresh project</small>
          </span>
        </div>
        <div className="studio-prefs-style-grid">
          {STYLE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`studio-prefs-style ${prefs.defaultStyle === option.id ? "is-active" : ""}`}
              aria-pressed={prefs.defaultStyle === option.id}
              onClick={() => update({ defaultStyle: option.id })}
            >
              <img src={`/style-thumbs/${option.id.toLowerCase().replace(/ /g, "-")}-sm.jpg`} alt="" draggable={false} />
              <span>{option.label}</span>
            </button>
          ))}
        </div>

        <div className="studio-prefs-row">
          <span className="studio-prefs-label">
            <strong>Default aspect ratio</strong>
            <small>"Auto" matches whatever you upload</small>
          </span>
          <div className="studio-prefs-chips">
            {ASPECT_RATIO_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={prefs.defaultAspectRatio === option.id ? "is-active" : ""}
                aria-pressed={prefs.defaultAspectRatio === option.id}
                onClick={() => update({ defaultAspectRatio: option.id })}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="studio-prefs-row">
          <span className="studio-prefs-label">
            <strong>Default style influence</strong>
            <small>How strongly the chosen style reshapes the render</small>
          </span>
          <div className="studio-prefs-slider">
            <input
              type="range"
              min={1}
              max={4}
              value={prefs.defaultStyleInfluence}
              onChange={(event) => update({ defaultStyleInfluence: Number(event.target.value) })}
            />
            <b>{STYLE_INFLUENCE_LABELS[prefs.defaultStyleInfluence - 1]}</b>
          </div>
        </div>

        <div className="studio-prefs-row">
          <span className="studio-prefs-label">
            <strong>Preserve source geometry</strong>
            <small>Keep openings and structural lines fixed by default</small>
          </span>
          <label className="studio-prefs-switch">
            <input
              type="checkbox"
              checked={prefs.defaultPreserveStructure}
              onChange={(event) => update({ defaultPreserveStructure: event.target.checked })}
            />
            <span />
          </label>
        </div>
      </section>

      <section className="studio-prefs-card">
        <header>
          <h2>Edit defaults</h2>
          <p>Used whenever you apply a change to a render.</p>
        </header>
        <div className="studio-prefs-row">
          <span className="studio-prefs-label">
            <strong>Default edit strength</strong>
            <small>How far an edit may depart from the current image</small>
          </span>
          <div className="studio-prefs-slider">
            <input
              type="range"
              min={1}
              max={4}
              value={prefs.defaultEditInfluence}
              onChange={(event) => update({ defaultEditInfluence: Number(event.target.value) })}
            />
            <b>{STYLE_INFLUENCE_LABELS[prefs.defaultEditInfluence - 1]}</b>
          </div>
        </div>
      </section>

      <section className="studio-prefs-card">
        <header>
          <h2>Guide &amp; tips</h2>
          <p>Replay the orientation walkthrough whenever you want a refresher.</p>
        </header>
        <div className="studio-prefs-row">
          <span className="studio-prefs-label">
            <strong>Studio tour</strong>
            <small>{toursCompleted ? "You've completed it" : "Not started yet"}</small>
          </span>
          <button type="button" className="studio-prefs-button" onClick={() => startTour("orientation")}>
            Replay tour
          </button>
        </div>
      </section>

      <button type="button" className="studio-prefs-reset" onClick={resetDefaults}>
        Reset render &amp; edit defaults
      </button>
    </div>
  );
}
