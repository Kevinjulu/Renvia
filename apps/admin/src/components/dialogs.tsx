import { useEffect, useId, useState, type FormEvent } from "react";
import { Button } from "./ui";
import { ModalFrame } from "./Overlay";

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  /** Styles the confirm button as destructive. */
  danger?: boolean;
}

interface PromptOptions {
  title: string;
  message?: string;
  label: string;
  defaultValue?: string;
  confirmLabel?: string;
  /** Blank answers are allowed unless this is set. */
  required?: boolean;
  placeholder?: string;
}

type Request =
  | ({ kind: "confirm"; resolve: (answer: boolean) => void } & ConfirmOptions)
  | ({ kind: "prompt"; resolve: (answer: string | null) => void } & PromptOptions);

let enqueue: ((request: Request) => void) | null = null;

/** In-app replacement for window.confirm; resolves false when cancelled. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!enqueue) return resolve(window.confirm(options.message ?? options.title));
    enqueue({ kind: "confirm", resolve, ...options });
  });
}

/** In-app replacement for window.prompt; resolves null when cancelled. */
export function promptDialog(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    if (!enqueue) return resolve(window.prompt(options.label, options.defaultValue ?? ""));
    enqueue({ kind: "prompt", resolve, ...options });
  });
}

/** Mount once near the app root; renders whichever confirm/prompt is waiting, one at a time. */
export function DialogHost() {
  const [queue, setQueue] = useState<Request[]>([]);
  useEffect(() => {
    enqueue = (request) => setQueue((current) => [...current, request]);
    return () => { enqueue = null; };
  }, []);
  const current = queue[0];
  if (!current) return null;
  const close = () => setQueue((items) => items.slice(1));
  return current.kind === "confirm"
    ? <ConfirmView key={queue.length} request={current} onDone={(answer) => { current.resolve(answer); close(); }} />
    : <PromptView key={queue.length} request={current} onDone={(answer) => { current.resolve(answer); close(); }} />;
}

function useEscape(onEscape: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onEscape(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEscape]);
}

function ConfirmView({ request, onDone }: { request: Extract<Request, { kind: "confirm" }>; onDone: (answer: boolean) => void }) {
  const titleId = useId();
  useEscape(() => onDone(false));
  return (
    <ModalFrame onClose={() => onDone(false)}>
      <div role="alertdialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-md rounded-2xl border border-hairline bg-canvas p-6 shadow-lift">
        <h2 id={titleId} className="text-lg font-semibold text-primary">{request.title}</h2>
        {request.message && <p className="mt-1 text-sm text-muted">{request.message}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" onClick={() => onDone(false)}>Cancel</Button>
          <Button type="button" autoFocus variant={request.danger ? "danger" : "primary"} onClick={() => onDone(true)}>{request.confirmLabel ?? "Confirm"}</Button>
        </div>
      </div>
    </ModalFrame>
  );
}

function PromptView({ request, onDone }: { request: Extract<Request, { kind: "prompt" }>; onDone: (answer: string | null) => void }) {
  const titleId = useId();
  const inputId = useId();
  const [value, setValue] = useState(request.defaultValue ?? "");
  useEscape(() => onDone(null));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (request.required && !value.trim()) return;
    onDone(value);
  };
  return (
    <ModalFrame onClose={() => onDone(null)}>
      <form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-md rounded-2xl border border-hairline bg-canvas p-6 shadow-lift">
        <h2 id={titleId} className="text-lg font-semibold text-primary">{request.title}</h2>
        {request.message && <p className="mt-1 text-sm text-muted">{request.message}</p>}
        <label htmlFor={inputId} className="mt-5 block text-sm font-medium text-primary">
          {request.label}
          <input id={inputId} autoFocus value={value} placeholder={request.placeholder} onChange={(event) => setValue(event.target.value)} className="mt-1.5 w-full rounded-xl border border-hairline bg-surface px-3 py-2.5 text-sm font-normal outline-none focus:border-blueprint focus:bg-canvas" />
        </label>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" onClick={() => onDone(null)}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={Boolean(request.required) && !value.trim()}>{request.confirmLabel ?? "Save"}</Button>
        </div>
      </form>
    </ModalFrame>
  );
}
