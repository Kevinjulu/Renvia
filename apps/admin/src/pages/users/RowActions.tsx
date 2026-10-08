import { useState } from "react";
import { Link } from "react-router-dom";
import type { AdminUser } from "@renvia/types";
import { Ban, Coins, MoreHorizontal, Shield, UserCheck } from "lucide-react";

export function RowActions({
  user,
  isSelf,
  busy,
  onGrant,
  onToggleDisabled,
  onChangeRole,
}: {
  user: AdminUser;
  isSelf: boolean;
  busy: boolean;
  onGrant: () => void;
  onToggleDisabled: () => void;
  onChangeRole: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isAdmin = user.role === "admin";

  return (
    <div className="relative flex justify-end">
      <button
        type="button"
        aria-label={`Actions for ${user.email}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-primary"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <>
          <button type="button" className="fixed inset-0 z-10 cursor-default" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-xl border border-hairline bg-canvas py-1 shadow-lift">
            <Link
              to={`/users/${user.id}`}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-surface"
              onClick={() => setOpen(false)}
            >
              Open detail
            </Link>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onGrant();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-surface"
            >
              <Coins size={14} /> Grant credits
            </button>
            <button
              type="button"
              disabled={isSelf || busy || (user.disabled && !isAdmin)}
              title={
                isSelf
                  ? "You can't change your own role"
                  : user.disabled && !isAdmin
                    ? "Enable the account before promoting"
                    : undefined
              }
              onClick={() => {
                setOpen(false);
                onChangeRole();
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40 ${
                isAdmin ? "text-rose-700" : "text-primary"
              }`}
            >
              <Shield size={14} />
              {isAdmin ? "Remove admin…" : "Make admin…"}
            </button>
            <button
              type="button"
              disabled={isSelf || busy}
              title={isSelf ? "You can't disable your own account" : undefined}
              onClick={() => {
                setOpen(false);
                onToggleDisabled();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
            >
              {user.disabled ? <UserCheck size={14} /> : <Ban size={14} />}
              {user.disabled ? "Enable" : "Disable"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
