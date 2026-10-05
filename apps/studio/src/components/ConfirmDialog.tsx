import { useEffect } from "react";
import { useFocusTrap } from "../lib/useFocusTrap";

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel?: string;
  confirmingLabel?: string;
  isConfirming?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel = "Delete",
  confirmingLabel = "Deleting…",
  isConfirming = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useFocusTrap<HTMLDivElement>(true, "[data-autofocus]");

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isConfirming) onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isConfirming, onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4"
      onClick={isConfirming ? undefined : onCancel}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        className="w-full max-w-sm rounded-xl border border-hairline bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="font-display text-base font-semibold text-primary">
          {title}
        </h2>
        <p id="confirm-dialog-description" className="mt-1.5 text-sm text-muted">{description}</p>
        <div className="mt-5 flex justify-end gap-2.5">
          <button
            type="button"
            data-autofocus
            onClick={onCancel}
            disabled={isConfirming}
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-secondary transition-colors hover:bg-surface-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isConfirming}
            className="rounded-lg bg-red-600 px-3.5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {isConfirming ? confirmingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
