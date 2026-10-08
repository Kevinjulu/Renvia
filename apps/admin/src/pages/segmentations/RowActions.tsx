import { useState } from "react";
import { Link } from "react-router-dom";
import type { AdminSegmentation } from "@renvia/types";
import { Check, Copy, ImageIcon, MoreHorizontal, Scan } from "lucide-react";

export function RowActions({
  item,
  copied,
  onOpen,
  onCopyId,
  onCopyError,
  onRecover,
  recovering,
}: {
  item: AdminSegmentation;
  copied: boolean;
  onOpen: () => void;
  onCopyId: () => void;
  onCopyError?: () => void;
  onRecover?: () => void;
  recovering: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative flex justify-end">
      <button
        type="button"
        aria-label={`Actions for segmentation ${item.id.slice(0, 8)}`}
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
              to={`/users/${item.userId}`}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-surface"
              onClick={() => setOpen(false)}
            >
              Open user
            </Link>
            <a
              href={item.imageUrl}
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
            {onRecover && (
              <button
                type="button"
                onClick={() => { setOpen(false); onRecover(); }}
                disabled={recovering}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-blueprint hover:bg-surface disabled:opacity-50"
              >
                <Scan size={14} /> {recovering ? "Recovering…" : "Recover selection"}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
