import { BillingStatus } from "../components/BillingStatus";
import { AccountMenu } from "../components/account/AccountMenu";

export function CanvasTopBar() {
  return (
    <div className="flex h-14 shrink-0 items-center justify-end gap-4 border-b border-hairline bg-white px-4">
      <button type="button" disabled title="Download (nothing to export yet)" className="text-faint">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 2v8m0 0 3-3m-3 3L5 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3 12.5h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </button>
      <BillingStatus />
      <AccountMenu />
    </div>
  );
}
