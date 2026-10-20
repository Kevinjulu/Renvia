import { useEffect, useState } from "react";
import { PROMPT_LONG_WORDS, type PromptPolishKind, type PromptPolishResponse } from "@renvia/types";
import { ApiError, useApiClient } from "../../lib/apiClient";

interface PromptAssistProps {
  prompt: string;
  kind: PromptPolishKind;
  /** A render with references: the suggestion leaves out requests that would redesign the source. */
  sourceLocked?: boolean;
  onUse: (prompt: string) => void;
}

const TIPS: Record<PromptPolishKind, string> = {
  render: "Short and specific works best: materials, light, setting.",
  edit: "One change, named plainly, works best.",
};

const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/**
 * The row under a prompt box: a friendly tip on writing prompts the model follows well, a nudge
 * when a prompt gets long, and "Polish", which suggests a short architectural rewrite the person
 * can use or ignore. Polishing is free (no credits), so the button says so.
 */
export function PromptAssist({ prompt, kind, sourceLocked = false, onUse }: PromptAssistProps) {
  const apiClient = useApiClient();
  const [suggestion, setSuggestion] = useState<PromptPolishResponse | null>(null);
  const [polishing, setPolishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isLong = wordCount(prompt) > PROMPT_LONG_WORDS;

  // Typing again clears an earlier "isn't available" or limit message.
  useEffect(() => {
    setError(null);
  }, [prompt]);

  const polish = async () => {
    setPolishing(true);
    setError(null);
    try {
      setSuggestion(await apiClient.polishPrompt(prompt, kind, sourceLocked));
    } catch (failure) {
      setSuggestion(null);
      setError(
        failure instanceof ApiError && failure.code === "polish_limit" && failure.detail
          ? failure.detail
          : "Polish isn't available right now. Your prompt is unchanged.",
      );
    } finally {
      setPolishing(false);
    }
  };

  const unchanged = !suggestion?.prompt || suggestion.prompt.trim() === prompt.trim();

  return (
    <>
      <div className="cp-prompt-tools">
        <button
          type="button"
          className="cp-prompt-polish"
          onClick={() => void polish()}
          disabled={polishing || !prompt.trim()}
          title="Suggests a clearer, shorter prompt. Free: it doesn't use credits."
        >
          {polishing ? "Polishing…" : <>✦ Polish <span className="cp-prompt-free">Free</span></>}
        </button>
        <small className={`cp-prompt-hint ${isLong ? "is-long" : ""}`} aria-live="polite">
          {isLong ? "Long prompts can confuse the render. Try Polish." : TIPS[kind]}
        </small>
      </div>

      {error && (
        <p className="cp-prompt-hint is-long" role="status">
          {error}
        </p>
      )}

      {suggestion && (
        <div className="cp-prompt-repair" role="status">
          <span className="cp-prompt-suggestion-label">Suggested prompt</span>
          {suggestion.prompt ? <p className="cp-prompt-suggestion">{suggestion.prompt}</p> : <p>Nothing left to suggest once the redesign requests are removed.</p>}
          {suggestion.notes.length > 0 && <p className="cp-prompt-notes">{suggestion.notes.join(" · ")}</p>}
          {suggestion.blocked.length > 0 && <p className="cp-prompt-notes">Kept out, to protect your design: {suggestion.blocked.join(" · ")}</p>}
          <div>
            <button
              type="button"
              disabled={unchanged}
              onClick={() => {
                onUse(suggestion.prompt);
                setSuggestion(null);
              }}
            >
              {unchanged ? "Already clear" : "Use it"}
            </button>
            <button type="button" onClick={() => setSuggestion(null)}>
              Keep mine
            </button>
          </div>
          <small className="cp-prompt-cost">
            Free · doesn't use credits
            {suggestion.remainingToday !== null && ` · ${suggestion.remainingToday} left today`}
          </small>
        </div>
      )}
    </>
  );
}
