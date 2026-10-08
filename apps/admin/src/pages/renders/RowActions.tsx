import { useState } from "react";
import { Link } from "react-router-dom";
import type { AdminRender } from "@renvia/types";
import { Check, Copy, FolderKanban, ImageIcon, MoreHorizontal } from "lucide-react";

export function RowActions({
  render,
  copied,
  onOpen,
  onCopyId,
  onCopyError,
}: {
  render: AdminRender;
  copied: boolean;
  onOpen: () => void;
  onCopyId: () => void;
  onCopyError?: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative flex justify-end">
      <button
        type="button"
        aria-label={`Actions for render ${render.id.slice(0, 8)}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-primary"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <>
          <button type="button" className="fixed inset-0 z-10 cursor-default" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-xl border border-hairline bg-canvas py-1 shadow-lift">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onOpen();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-surface"
            >
              Open detail
            </button>
            <Link
              to={`/users/${render.userId}`}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-surface"
              onClick={() => setOpen(false)}
            >
              Open user
            </Link>
            <Link
              to={`/projects?detail=${render.projectId}`}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-surface"
              onClick={() => setOpen(false)}
            >
              <FolderKanban size={14} /> Open project
            </Link>
            <a
              href={render.resultImageUrl ?? render.sourceImageUrl}
              target="_blank"
              rel="noreferrer"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-surface"
              onClick={() => setOpen(false)}
            >
              <ImageIcon size={14} /> Open image
            </a>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onCopyId();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-surface"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy ID"}
            </button>
            {onCopyError && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onCopyError();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-surface"
              >
                <Copy size={14} /> Copy error
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
