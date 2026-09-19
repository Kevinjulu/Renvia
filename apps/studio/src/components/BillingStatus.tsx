import { useNavigate } from "react-router-dom";
import { useAccountStore } from "../lib/useAccountStore";

/** Credits pill + Upgrade button — shared between the dashboard and canvas top bars. */
export function BillingStatus() {
  const navigate = useNavigate();
  const me = useAccountStore((state) => state.me);
  const isAdmin = me?.role === "admin";
  const credits = me?.creditBalance ?? 0;
  const isLow = !isAdmin && me !== null && credits <= 5;

  return (
    <div className="flex items-center gap-4">
      <div
        className={`flex items-center gap-1.5 text-sm tabular-nums ${isLow ? "text-[#a26414]" : "text-secondary"}`}
        title={isAdmin ? "Admins render without credits" : `${credits} ${credits === 1 ? "credit" : "credits"} left`}
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true" className={isLow ? "text-glow" : "text-blueprint"}>
          <path d="M6.5 1.2 7.6 4.4 10.8 5.5 7.6 6.6 6.5 9.8 5.4 6.6 2.2 5.5 5.4 4.4Z" fill="currentColor" />
        </svg>
        {me === null ? "–" : isAdmin ? "∞" : credits}
        <span className="sr-only">credits</span>
      </div>
      {!isAdmin && (
        <button
          type="button"
          onClick={() => navigate("/billing")}
          className="group flex items-center gap-1.5 rounded-full bg-primary py-1.5 pl-2.5 pr-3.5 text-sm font-medium text-white transition-all duration-150 hover:opacity-90 active:scale-[0.97]"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true" className="text-glow transition-transform duration-150 group-hover:scale-110">
            <path d="M6.5 1.2 7.6 4.4 10.8 5.5 7.6 6.6 6.5 9.8 5.4 6.6 2.2 5.5 5.4 4.4Z" fill="currentColor" />
          </svg>
          Upgrade
        </button>
      )}
    </div>
  );
}
