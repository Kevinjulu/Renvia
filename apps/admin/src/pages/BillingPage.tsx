import { AlertTriangle, CreditCard, ReceiptText, Webhook } from "lucide-react";
import { useState } from "react";
import { Card, EmptyState, ErrorNote, Pill, StatCard } from "../components/ui";
import { PageHero } from "../components/PageHero";
import { useAdminApi } from "../lib/api";
import { formatNumber, formatRelative, formatUsd } from "../lib/format";
import { navForPath } from "../lib/nav";
import { useLoad } from "../lib/useLoad";

export function BillingPage() {
  const api = useAdminApi();
  const { data, error, reload } = useLoad(() => api.getBilling(), [api], 30_000);
  const [refunding, setRefunding] = useState<string | null>(null);
  const [refundError, setRefundError] = useState<string | null>(null);
  const nav = navForPath("/billing");
  const refund = async (id: string) => {
    if (!window.confirm("Refund this payment? This automatically removes the unspent purchased credits.")) return;
    setRefunding(id); setRefundError(null);
    try { await api.refundPayment(id); await reload(); }
    catch (reason) { setRefundError(reason instanceof Error ? reason.message : "Could not refund payment."); }
    finally { setRefunding(null); }
  };
  return <>
    <PageHero title={nav.title} description={nav.description} image={nav.banner} />
    {error && <ErrorNote onRetry={reload}>{error}</ErrorNote>}
    {refundError && <ErrorNote onRetry={() => setRefundError(null)}>{refundError}</ErrorNote>}
    {!data ? null : <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Captured revenue" value={formatUsd(data.summary.paidUsd)} icon={CreditCard} accent="emerald" />
        <StatCard label="Refunded" value={formatUsd(data.summary.refundedUsd)} icon={ReceiptText} accent={data.summary.refundedUsd ? "amber" : "neutral"} />
        <StatCard label="Webhook failures" value={formatNumber(data.summary.failedWebhooks)} icon={AlertTriangle} accent={data.summary.failedWebhooks ? "rose" : "neutral"} />
        <StatCard label="Awaiting webhook" value={formatNumber(data.summary.pendingWebhooks)} icon={Webhook} accent={data.summary.pendingWebhooks ? "amber" : "neutral"} />
      </div>
      <Card title="Plans">
        <div className="-mx-5 overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm"><thead><tr className="border-b border-hairline text-xs uppercase tracking-wide text-faint"><th className="px-5 py-3">Plan</th><th className="px-5 py-3">Price</th><th className="px-5 py-3">Subscribers</th><th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y divide-hairline">{data.plans.map((plan) => <tr key={plan.id}><td className="px-5 py-3"><p className="font-medium text-primary">{plan.name}</p><p className="text-xs text-faint">{plan.slug}</p></td><td className="px-5 py-3">{plan.currency} {(plan.priceCents / 100).toFixed(2)}</td><td className="px-5 py-3">{formatNumber(plan.subscribers)}</td><td className="px-5 py-3"><Pill tone={plan.active ? "emerald" : "neutral"}>{plan.active ? "Active" : "Inactive"}</Pill></td></tr>)}</tbody></table></div>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2"><Card title="Recent payments">{data.payments.length === 0 ? <EmptyState icon={CreditCard}>No provider payments recorded yet.</EmptyState> : <ul className="divide-y divide-hairline">{data.payments.map((payment) => <li key={payment.id} className="flex items-center justify-between gap-3 py-3"><span className="min-w-0"><span className="block truncate text-sm font-medium text-primary">{payment.userEmail}</span><span className="block truncate text-xs text-faint">{payment.provider} · {payment.providerPaymentId}</span></span><span className="text-right"><Pill tone={payment.status === "paid" ? "emerald" : payment.status === "refunded" ? "amber" : "neutral"}>{payment.status}</Pill><span className="mt-1 block text-xs text-muted">{payment.currency} {(payment.amountCents / 100).toFixed(2)}</span>{payment.provider === "paypal" && payment.status === "paid" && <button type="button" className="mt-2 text-xs font-medium text-rose-700 underline disabled:opacity-50" disabled={refunding !== null} onClick={() => void refund(payment.id)}>{refunding === payment.id ? "Refunding…" : "Refund"}</button>}</span></li>)}</ul>}</Card>
      <Card title="Provider webhook health">{data.webhooks.length === 0 ? <EmptyState icon={Webhook}>No provider events yet. Configure PayPal, then send a sandbox event.</EmptyState> : <ul className="divide-y divide-hairline">{data.webhooks.map((event) => <li key={event.id} className="py-3"><div className="flex items-center justify-between gap-3"><span className="min-w-0 truncate text-sm font-medium text-primary">{event.eventType}</span><Pill tone={event.status === "processed" ? "emerald" : event.status === "failed" ? "red" : "amber"}>{event.status}</Pill></div><p className="mt-1 text-xs text-faint">{event.provider} · {event.attempts} attempt{event.attempts === 1 ? "" : "s"} · {formatRelative(event.createdAt)}</p>{event.failureMessage && <p className="mt-1 text-xs text-rose-600">{event.failureMessage}</p>}</li>)}</ul>}</Card></div>
    </div>}
  </>;
}
