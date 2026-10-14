import { useCallback, useEffect, useMemo, useState } from "react";
import type { BillingCatalogResponse, BillingCheckout, CreateCheckoutRequest, CreateCheckoutResponse, CreditPack, MeResponse, PaymentMethod } from "@renvia/types";
import { ApiError } from "../lib/apiClient";
import { refreshAccount, useAccountStore } from "../lib/useAccountStore";
import { packOutcome } from "./billingPresentation";
import { creditPricesFor } from "../lib/creditPrices";
import { CheckoutDialog, formatPrice, type CheckoutItem } from "./CheckoutDialog";
import { PlansSection } from "./PlansSection";
import { CreditIcon, RefundIcon, SparkleIcon } from "./icons";

type StudioApi = {
  getMe: () => Promise<MeResponse>;
  getBillingCatalog: () => Promise<BillingCatalogResponse>;
  createCheckout: (body: CreateCheckoutRequest) => Promise<CreateCheckoutResponse>;
  confirmCheckout: (id: string) => Promise<{ checkoutId: string; status: BillingCheckout["status"] }>;
  cancelCheckout: (id: string) => Promise<{ status: "canceled" }>;
  cancelSubscription: () => Promise<{ status: "cancellation_requested"; endsAt: string | null }>;
};

const CHECKOUT_LABEL: Record<BillingCheckout["status"], string> = {
  created: "Started",
  pending: "Awaiting payment",
  paid: "Paid",
  expired: "Expired",
  canceled: "Cancelled",
  failed: "Failed",
};

const PROVIDER_LABEL: Record<string, string> = { paypal: "PayPal", paystack: "Paystack" };

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function errorText(reason: unknown, fallback: string) {
  return reason instanceof ApiError ? reason.detail ?? fallback : fallback;
}

function BillingSkeleton() {
  return (
    <div className="billing-page" role="status" aria-label="Loading your billing details">
      <div className="billing-skeleton is-summary" />
      <div className="billing-pack-grid">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="billing-skeleton is-pack" />
        ))}
      </div>
    </div>
  );
}

/** What the current plan does next, in one line. */
function renewalLine(me: MeResponse | null): string | null {
  const entitlement = me?.entitlement;
  if (!entitlement || entitlement.plan.interval === "none") return null;
  if (entitlement.complimentary) return null;
  const end = entitlement.currentPeriodEnd ? formatDay(entitlement.currentPeriodEnd) : null;
  const billed = entitlement.billingInterval === "year" ? "Billed yearly" : "Billed monthly";
  if (entitlement.status === "past_due") return `${billed} · the last payment failed. Update it with your payment provider${end ? ` before ${end}` : ""}.`;
  if (entitlement.autoRenews) return `${billed} · renews ${end ?? "automatically"}`;
  return end ? `${billed} · ends ${end} unless you renew` : billed;
}

/** Customer billing surfaces only server-priced plans and packs, and verified checkout state. */
export function BillingSection({ api }: { api: StudioApi }) {
  const me = useAccountStore((state) => state.me);
  const [catalog, setCatalog] = useState<BillingCatalogResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<CheckoutItem | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const bestValueSku = useMemo(() => {
    if (!catalog || catalog.creditPacks.length < 2) return null;
    return catalog.creditPacks.reduce((best, pack) => (pack.priceCents / pack.credits < best.priceCents / best.credits ? pack : best)).sku;
  }, [catalog]);
  const packNames = useMemo(() => new Map(catalog?.creditPacks.map((pack) => [pack.sku, pack.name]) ?? []), [catalog]);
  const packMethods = useMemo(
    () => (catalog ? (Object.keys(catalog.paymentMethods) as PaymentMethod[]).filter((method) => catalog.paymentMethods[method]) : []),
    [catalog],
  );

  const loadCatalog = useCallback(async () => setCatalog(await api.getBillingCatalog()), [api]);

  // Back from a payment page: settle what can be settled now, then show the result.
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(window.location.search);
    const checkoutId = params.get("checkout");
    const cancelled = params.get("paypal") === "cancel" || params.get("cancelled") === "1";
    const settle = async () => {
      if (checkoutId && cancelled) {
        await api.cancelCheckout(checkoutId).catch(() => undefined);
        if (active) setNotice("Checkout was cancelled. No payment was taken.");
      } else if (checkoutId) {
        const result = await api.confirmCheckout(checkoutId);
        await refreshAccount(api.getMe);
        if (!active) return;
        if (result.status === "paid") setNotice("Payment confirmed. Your plan and credits are up to date.");
        else if (result.status === "pending") {
          setNotice("Payment received. It can take a minute for your provider to confirm it; this page updates when it does.");
          // PayPal subscriptions start from PayPal's own confirmation, a moment after the return.
          for (const delay of [4000, 8000, 15000]) {
            await new Promise((resolve) => setTimeout(resolve, delay));
            if (!active) return;
            await refreshAccount(api.getMe);
            if (useAccountStore.getState().me?.entitlement.plan.interval !== "none") {
              setNotice("Payment confirmed. Your plan is active.");
              break;
            }
          }
        } else setNotice("That payment didn't go through, and nothing was charged. You can try again.");
      }
      await loadCatalog();
    };
    void settle().catch((reason: unknown) => {
      if (!active) return;
      setError(errorText(reason, "Could not confirm or load billing."));
      void loadCatalog().catch(() => undefined);
    });
    if (checkoutId) window.history.replaceState({}, "", window.location.pathname);
    return () => {
      active = false;
    };
  }, [api, loadCatalog]);

  // Links to /billing#plans (from the download lock, for one) land on the plans once they've loaded.
  const loaded = catalog !== null;
  useEffect(() => {
    if (loaded && window.location.hash === "#plans") document.getElementById("plans")?.scrollIntoView({ block: "start" });
  }, [loaded]);

  const cancelRenewal = async () => {
    setCancelling(true);
    setError(null);
    try {
      const result = await api.cancelSubscription();
      await refreshAccount(api.getMe);
      setNotice(result.endsAt ? `Your plan won't renew. You keep it until ${formatDay(result.endsAt)}.` : "Your plan won't renew.");
      setConfirmingCancel(false);
    } catch (reason) {
      setError(errorText(reason, "Couldn't cancel. Try again, or contact support."));
    } finally {
      setCancelling(false);
    }
  };

  const buyPack = (pack: CreditPack) => setCheckout({ kind: "credit_pack", product: pack.sku, name: pack.name, usdCents: pack.priceCents, methods: packMethods });

  const prices = creditPricesFor(me);
  const standardCost = prices.render;
  const entitlement = me?.entitlement ?? null;
  const planName = entitlement?.plan.name ?? "Your plan";
  const planStatus = entitlement?.status ?? "active";
  const complimentary = entitlement?.complimentary ?? null;
  const balanceOutcome = packOutcome(me?.creditBalance ?? 0, standardCost);
  const renewal = renewalLine(me);
  const onFree = !entitlement || entitlement.plan.interval === "none";
  const anyMethod = packMethods.length > 0;

  if (!catalog && error) {
    return (
      <div className="billing-page">
        <div className="billing-notice is-error" role="alert">{error}</div>
      </div>
    );
  }
  if (!catalog) return <BillingSkeleton />;

  return (
    <div className="billing-page">
      {notice && <div className="billing-notice is-success" role="status">{notice}</div>}
      {error && <div className="billing-notice is-error" role="alert">{error}</div>}

      <section className="billing-card billing-summary" aria-label="Account summary">
        <div className="billing-balance">
          <span className="billing-balance-label">
            <CreditIcon size={13} />
            Available credits
          </span>
          <strong>{me?.creditBalance ?? "—"}</strong>
          <small>
            {balanceOutcome.renders === null ? "Standard renders currently require no credits." : `Enough for ${balanceOutcome.renderLabel} at your current rate.`}
          </small>
        </div>
        <div className="billing-plan">
          <span className="billing-plan-label">Current plan</span>
          <div>
            <b>{planName}</b>
            <em className={`billing-status is-${planStatus}`}>{planStatus.replace("_", " ")}</em>
          </div>
          {complimentary && (
            <small className="billing-plan-note">
              Complimentary{complimentary.endsAt ? ` until ${formatDay(complimentary.endsAt)}` : ""}
            </small>
          )}
          {renewal && <small className="billing-plan-note">{renewal}</small>}
          {onFree && !complimentary && <small className="billing-plan-note">Upgrade to download clean files and get monthly credits.</small>}
          {!onFree && !complimentary && entitlement?.autoRenews && (
            confirmingCancel ? (
              <div className="billing-plan-confirm">
                <p>Stop renewing? You keep {planName} until {entitlement.currentPeriodEnd ? formatDay(entitlement.currentPeriodEnd) : "the end of this period"}, then move to Free.</p>
                <div>
                  <button type="button" onClick={() => setConfirmingCancel(false)} disabled={cancelling}>Keep plan</button>
                  <button type="button" className="is-danger" onClick={() => void cancelRenewal()} disabled={cancelling}>{cancelling ? "Cancelling…" : "Stop renewing"}</button>
                </div>
              </div>
            ) : (
              <button type="button" className="billing-plan-link" onClick={() => setConfirmingCancel(true)}>Cancel renewal</button>
            )
          )}
          {!onFree && !complimentary && !entitlement?.autoRenews && (
            <a className="billing-plan-link" href="#plans">Renew or change plan</a>
          )}
        </div>
      </section>

      {!anyMethod && (
        <div className="billing-notice is-neutral" role="status">
          <b>Checkout is being prepared.</b> You can review plans and packs now; paying unlocks once card, M-Pesa and PayPal payments are switched on.
        </div>
      )}

      <PlansSection catalog={catalog} me={me} onChoose={setCheckout} />

      <section className="billing-card" aria-labelledby="billing-cost-title">
        <header>
          <h2 id="billing-cost-title">How credits work</h2>
          <p>Credits are spent per image, at the rate shown below. Plan credits refresh monthly and are used first; credits you buy never expire.</p>
        </header>
        <div className="billing-cost-row">
          <span className="billing-cost-icon"><CreditIcon size={14} /></span>
          <span className="billing-cost-label">
            <strong>Standard render</strong>
            <small>The default for every render and edit</small>
          </span>
          <b>{standardCost} {standardCost === 1 ? "credit" : "credits"}</b>
        </div>
        <div className="billing-cost-row">
          <span className="billing-cost-icon"><SparkleIcon /></span>
          <span className="billing-cost-label">
            <strong>Strict source fidelity</strong>
            <small>For when matching the source exactly matters most</small>
          </span>
          <b>{prices.fidelity} credits</b>
        </div>
        <div className="billing-cost-row">
          <span className="billing-cost-icon"><RefundIcon /></span>
          <span className="billing-cost-label">
            <strong>Failed renders are refunded</strong>
            <small>Credits come back automatically if a render fails before delivery</small>
          </span>
          <b>Free</b>
        </div>
      </section>

      <section className="billing-section" aria-labelledby="credit-packs-title">
        <header className="billing-section-heading">
          <h2 id="credit-packs-title">Top up credits</h2>
          <p>One-time purchases by card, M-Pesa or PayPal. Credits are added once payment is confirmed and never expire.</p>
        </header>
        {catalog.creditPacks.length === 0 ? (
          <div className="billing-empty">
            <p className="billing-empty-title">No credit packs available yet</p>
            <p>Check back soon — new packs will appear here.</p>
          </div>
        ) : (
          <div className="billing-pack-grid">
            {catalog.creditPacks.map((pack) => {
              const isBestValue = pack.sku === bestValueSku;
              const outcome = packOutcome(pack.credits, standardCost);
              return (
                <article key={pack.sku} className={`billing-pack ${isBestValue ? "is-best-value" : ""}`}>
                  {isBestValue && <span className="billing-pack-badge">Best value</span>}
                  <h3>{pack.name}</h3>
                  <div className="billing-pack-price">
                    <strong>{formatPrice(pack.priceCents, pack.currency)}</strong>
                    <span>{pack.credits} credits</span>
                  </div>
                  <p className="billing-pack-detail">
                    {outcome.renders === null ? "Standard renders currently require no credits." : `Up to ${outcome.renderLabel}.`} {outcome.guidance}
                  </p>
                  <p className="billing-pack-unit">{formatPrice(Math.round(pack.priceCents / pack.credits), pack.currency)} per credit</p>
                  <button type="button" disabled={!anyMethod} onClick={() => buyPack(pack)}>
                    {anyMethod ? "Buy credits" : "Checkout coming soon"}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="billing-section" aria-labelledby="billing-history-title">
        <header className="billing-section-heading">
          <h2 id="billing-history-title">Payment history</h2>
          <p>Your most recent checkouts, newest first.</p>
        </header>
        {catalog.recentCheckouts.length === 0 ? (
          <div className="billing-empty">
            <p className="billing-empty-title">No payments yet</p>
            <p>When you subscribe or top up credits, the payment and its status will show up here.</p>
          </div>
        ) : (
          <div className="billing-history">
            {catalog.recentCheckouts.map((item) => (
              <article key={item.id}>
                <span className={`billing-history-mark is-${item.status}`} aria-hidden="true">
                  {item.status === "paid" ? "✓" : "·"}
                </span>
                <div>
                  <strong>
                    {item.kind === "subscription"
                      ? `${item.planName ?? "Plan"} · ${item.billingInterval === "year" ? "Yearly" : "Monthly"}`
                      : (item.creditPackSku && packNames.get(item.creditPackSku)) ?? "Credit purchase"}
                  </strong>
                  <small>{formatDate(item.updatedAt)} · {PROVIDER_LABEL[item.provider] ?? item.provider}</small>
                </div>
                <b>{formatPrice(item.amountCents, item.currency)}</b>
                <em className={`billing-history-status is-${item.status}`}>{CHECKOUT_LABEL[item.status] ?? item.status}</em>
              </article>
            ))}
          </div>
        )}
      </section>

      {checkout && <CheckoutDialog item={checkout} catalog={catalog} createCheckout={api.createCheckout} onClose={() => setCheckout(null)} />}
    </div>
  );
}
