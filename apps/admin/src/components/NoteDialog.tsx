import { useEffect, useId, useState, type FormEvent } from "react";
import { Button } from "./ui";

interface NoteDialogProps {
  title: string;
  /** One line under the title saying what confirming does. */
  description?: string;
  label: string;
  confirmLabel: string;
  /** Required notes keep the confirm button disabled until something is typed. */
  required?: boolean;
  variant?: "primary" | "danger";
  /** Rejects with an Error whose message is shown in the dialog; resolves to close it. */
  onConfirm: (note: string) => Promise<unknown>;
  onClose: () => void;
}

/** Collects a short note before an operator action, in place of window.prompt. */
export function NoteDialog({ title, description, label, confirmLabel, required = false, variant = "primary", onConfirm, onClose }: NoteDialogProps) {
  const titleId = useId();
  const noteId = useId();
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSubmit = !saving && (!required || note.trim().length > 0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      await onConfirm(note.trim());
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Something went wrong");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-ink-950/40 p-4 backdrop-blur-sm" onMouseDown={() => !saving && onClose()}>
      <form
        onSubmit={(event) => void submit(event)}
        onMouseDown={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-hairline bg-canvas p-6 shadow-lift"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="text-lg font-semibold text-primary">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        <label className="mt-5 block text-sm" htmlFor={noteId}>
          <span className="font-medium text-primary">{label}</span>
          {!required && <span className="text-faint"> (optional)</span>}
          <textarea
            id={noteId}
            autoFocus
            rows={3}
            maxLength={300}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="mt-1.5 w-full resize-none rounded-xl border border-hairline bg-surface px-3 py-2.5 text-sm outline-none focus:border-blueprint focus:bg-canvas"
          />
        </label>
        {error && <p role="alert" className="mt-3 text-sm text-rose-600">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" variant={variant} disabled={!canSubmit}>{saving ? "Saving…" : confirmLabel}</Button>
        </div>
      </form>
    </div>
  );
}
