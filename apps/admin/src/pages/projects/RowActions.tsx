import { useState } from "react";
import { Link } from "react-router-dom";
import type { AdminProject } from "@renvia/types";
import { Check, Copy, ImageIcon, MoreHorizontal } from "lucide-react";

export function RowActions({
  project,
  copied,
  onOpen,
  onCopy,
}: {
  project: AdminProject;
  copied: boolean;
  onOpen: () => void;
  onCopy: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative flex justify-end">
      <button
        type="button"
        aria-label={`Actions for ${project.name}`}
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
              to={`/users/${project.ownerId}`}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-surface"
              onClick={() => setOpen(false)}
            >
              Open owner
            </Link>
            <Link
              to={`/renders?projectId=${project.id}`}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-surface"
              onClick={() => setOpen(false)}
            >
              <ImageIcon size={14} /> View renders
            </Link>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onCopy();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-surface"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied ID" : "Copy ID"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
