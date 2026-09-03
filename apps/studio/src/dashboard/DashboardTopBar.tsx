import { BillingStatus } from "../components/BillingStatus";
import { AccountMenu } from "../components/account/AccountMenu";

export function DashboardTopBar({ title }: { title: string }) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-hairline bg-white px-8">
      <h1 className="font-display text-lg font-semibold text-primary">{title}</h1>
      <div className="flex items-center gap-4">
        <BillingStatus />
        <AccountMenu />
      </div>
    </header>
  );
}
