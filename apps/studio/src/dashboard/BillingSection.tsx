import { useCallback, useEffect, useMemo, useState } from "react";
import type { BillingCatalogResponse, BillingCheckout, CreditPack, MeResponse } from "@renvia/types";
import { ApiError } from "../lib/apiClient";
import { refreshAccount, useAccountStore } from "../lib/useAccountStore";
import { packOutcome } from "./billingPresentation";
import { CreditIcon, RefundIcon, SparkleIcon } from "./icons";

type StudioApi = {
  getMe: () => Promise<MeResponse>;
  getBillingCatalog: () => Promise<BillingCatalogResponse>;
  createPaypalCheckout: (body: { kind: "credit_pack"; product: string; idempotencyKey: string }) => Promise<{ approvalUrl: string | null }>;
  capturePaypalCheckout: (id: string) => Promise<{ checkoutId: string; status: "paid" }>;
};

const CHECKOUT_LABEL: Record<BillingCheckout["status"], string> = {
  created: "Started",
  pending: "Awaiting payment",
  paid: "Paid",
  expired: "Expired",
  canceled: "Cancelled",
  failed: "Failed",
};

function price(cents: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(cents / 100);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
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

/** Customer billing surfaces only server-priced packs and verified checkout state. */
export function BillingSection({ api }: { api: StudioApi }) {
  const me = useAccountStore((state) => state.me);
  const [catalog, setCatalog] = useState<BillingCatalogResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);

  const bestValueSku = useMemo(() => {
    if (!catalog || catalog.creditPacks.length < 2) return null;
    return catalog.creditPacks.reduce((best, pack) => (pack.priceCents / pack.credits < best.priceCents / best.credits ? pack : best)).sku;
  }, [catalog]);
  const packNames = useMemo(() => new Map(catalog?.creditPacks.map((pack) => [pack.sku, pack.name]) ?? []), [catalog]);

  const loadCatalog = useCallback(async () => setCatalog(await api.getBillingCatalog()), [api]);
  const buy = async (pack: CreditPack) => {
    setStarting(pack.sku);
    setError(null);
    try {
      const checkout = await api.createPaypalCheckout({ kind: "credit_pack", product: pack.sku, idempotencyKey: crypto.randomUUID() });
      if (!checkout.approvalUrl) throw new Error("Checkout approval is unavailable");
      window.location.assign(checkout.approvalUrl);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.detail ?? "Could not start checkout." : "Could not start checkout.");
      setStarting(null);
    }
  };

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(window.location.search);
    const checkoutId = params.get("checkout");
    const paypalResult = params.get("paypal");
    const settle = async () => {
      if (checkoutId && paypalResult === "return") {
        await api.capturePaypalCheckout(checkoutId);
        await refreshAccount(api.getMe);
        if (active) setNotice("Payment confirmed. Your credit balance has been updated.");
      } else if (checkoutId && paypalResult === "cancel" && active) setNotice("Checkout was cancelled. No payment was taken.");
      await loadCatalog();
    };
    void settle().catch((reason: unknown) => {
      if (!active) return;
      setError(reason instanceof ApiError ? reason.detail ?? "Could not confirm or load billing." : "Could not confirm or load billing.");
    });
    if (checkoutId) window.history.replaceState({}, "", window.location.pathname);
    return () => {
      active = false;
    };
  }, [api, loadCatalog]);

  const standardCost = me?.creditsPerImage ?? 1;
  const planName = me?.entitlement.plan.name ?? "Your plan";
  const planStatus = me?.entitlement.status ?? "active";
  const complimentary = me?.entitlement.complimentary ?? null;
  const balanceOutcome = packOutcome(me?.creditBalance ?? 0, standardCost);

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
              Complimentary{complimentary.endsAt ? ` until ${new Date(complimentary.endsAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}` : ""}
            </small>
          )}
        </div>
      </section>

      <section className="billing-card" aria-labelledby="billing-cost-title">
        <header>
          <h2 id="billing-cost-title">How credits work</h2>
          <p>Credits are spent per image, at the rate shown below.</p>
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
          <b>{standardCost * 2} credits</b>
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
          <p>One-time purchases through PayPal. Credits are added only after payment is confirmed.</p>
        </header>
        {!catalog.paypalCheckoutAvailable && (
          <div className="billing-notice is-neutral" role="status">
            <b>Checkout is being prepared.</b> You can review the packs now; purchasing unlocks once PayPal is connected.
          </div>
        )}
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
                    <strong>{price(pack.priceCents, pack.currency)}</strong>
                    <span>{pack.credits} credits</span>
                  </div>
                  <p className="billing-pack-detail">
                    {outcome.renders === null ? "Standard renders currently require no credits." : `Up to ${outcome.renderLabel}.`} {outcome.guidance}
                  </p>
                  <p className="billing-pack-unit">{price(pack.priceCents / pack.credits, pack.currency)} per credit</p>
                  <button type="button" disabled={!catalog.paypalCheckoutAvailable || starting !== null} onClick={() => void buy(pack)}>
                    {starting === pack.sku ? "Opening PayPal…" : catalog.paypalCheckoutAvailable ? "Buy with PayPal" : "Checkout coming soon"}
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
            <p>When you top up credits, the purchase and its status will show up here.</p>
          </div>
        ) : (
          <div className="billing-history">
            {catalog.recentCheckouts.map((checkout) => (
              <article key={checkout.id}>
                <span className={`billing-history-mark is-${checkout.status}`} aria-hidden="true">
                  {checkout.status === "paid" ? "✓" : "·"}
                </span>
                <div>
                  <strong>{(checkout.creditPackSku && packNames.get(checkout.creditPackSku)) ?? "Credit purchase"}</strong>
                  <small>{formatDate(checkout.updatedAt)} · PayPal</small>
                </div>
                <b>{price(checkout.amountCents, checkout.currency)}</b>
                <em className={`billing-history-status is-${checkout.status}`}>{CHECKOUT_LABEL[checkout.status] ?? checkout.status}</em>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
