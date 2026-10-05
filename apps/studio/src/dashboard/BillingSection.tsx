import { useEffect, useMemo, useState } from "react";
import type { BillingCatalogResponse, CreditPack, MeResponse } from "@renvia/types";
import { ApiError } from "../lib/apiClient";
import { refreshAccount, useAccountStore } from "../lib/useAccountStore";

type StudioApi = {
  getMe: () => Promise<MeResponse>;
  getBillingCatalog: () => Promise<BillingCatalogResponse>;
  createPaypalCheckout: (body: { kind: "credit_pack"; product: string; idempotencyKey: string }) => Promise<{ approvalUrl: string | null }>;
  capturePaypalCheckout: (id: string) => Promise<{ checkoutId: string; status: "paid" }>;
};

function price(cents: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(cents / 100);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function checkoutLabel(status: string) {
  return status === "paid" ? "Paid" : status === "pending" ? "Awaiting payment" : status === "created" ? "Started" : status;
}

/** Customer billing surfaces only server-priced packs and verified checkout state. */
export function BillingSection({ api }: { api: StudioApi }) {
  const me = useAccountStore((state) => state.me);
  const [catalog, setCatalog] = useState<BillingCatalogResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const bestValueSku = useMemo(() => {
    if (!catalog?.creditPacks.length) return null;
    return catalog.creditPacks.reduce((best, pack) => pack.priceCents / pack.credits < best.priceCents / best.credits ? pack : best).sku;
  }, [catalog]);
  const loadCatalog = async () => setCatalog(await api.getBillingCatalog());
  const buy = async (pack: CreditPack) => {
    setStarting(pack.sku); setError(null);
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
    return () => { active = false; };
  }, [api]);

  const standardCost = me?.creditsPerImage ?? 1;
  const planName = me?.entitlement.plan.name ?? "Your plan";
  const planStatus = me?.entitlement.status ?? "active";
  if (!catalog && error) return <div className="feature-notice" role="alert">{error}</div>;
  if (!catalog) return <div className="feature-notice" role="status">Loading your billing workspace…</div>;

  return <div className="billing-page">
    {notice && <div className="billing-notice is-success" role="status">{notice}</div>}
    {error && <div className="billing-notice is-error" role="alert">{error}</div>}
    <section className="billing-hero" aria-label="Billing summary">
      <div className="billing-hero-copy"><span className="billing-kicker">RENVIA CREDITS</span><h2>Keep your next idea moving.</h2><p>Credits are ready when you are. Choose a pack below, then pay securely through PayPal when checkout is available.</p></div>
      <div className="billing-balance-card"><span>Available now</span><strong>{me?.creditBalance ?? "—"}</strong><small>render credits</small><div className="billing-balance-rule" /><b>{planName} <em className={`billing-status is-${planStatus}`}>{planStatus.replace("_", " ")}</em></b></div>
    </section>
    <section className="billing-cost-guide" aria-label="How credits work">
      <article><span className="billing-guide-icon">◈</span><div><b>Standard render</b><p>{standardCost} credit per image at your current rate.</p></div></article>
      <article><span className="billing-guide-icon">✦</span><div><b>Strict source fidelity</b><p>{standardCost * 2} credits per image when source accuracy matters most.</p></div></article>
      <article><span className="billing-guide-icon">↺</span><div><b>Failed work is protected</b><p>Credits are returned when a render fails before delivery.</p></div></article>
    </section>
    <section className="billing-packs-section" aria-labelledby="credit-packs-title">
      <div className="billing-section-heading"><div><span>FLEXIBLE CAPACITY</span><h2 id="credit-packs-title">Choose credits that fit your workflow</h2></div><p>Prices and credit amounts are confirmed on the secure checkout.</p></div>
      {!catalog.paypalCheckoutAvailable && <div className="billing-notice is-neutral" role="status"><b>Checkout is being prepared.</b> You can review available packs now; purchasing will unlock once PayPal is connected.</div>}
      {catalog.creditPacks.length === 0 ? <div className="feature-notice">No credit packs are available yet.</div> : <div className="billing-pack-grid">{catalog.creditPacks.map((pack) => {
        const isBestValue = pack.sku === bestValueSku;
        const standardRenders = Math.floor(pack.credits / standardCost);
        return <article key={pack.sku} className={`billing-pack ${isBestValue ? "is-best-value" : ""}`}>
          {isBestValue && <span className="billing-pack-badge">Best value</span>}<span className="billing-pack-label">CREDIT PACK</span><h3>{pack.name}</h3>
          <div className="billing-pack-price"><strong>{price(pack.priceCents, pack.currency)}</strong><span>{pack.credits} credits</span></div><p className="billing-pack-detail">Up to {standardRenders} standard {standardRenders === 1 ? "render" : "renders"} at your current rate.</p><p className="billing-pack-unit">{price(Math.round(pack.priceCents / pack.credits), pack.currency)} per credit</p>
          <button type="button" disabled={!catalog.paypalCheckoutAvailable || starting !== null} onClick={() => void buy(pack)}>{starting === pack.sku ? "Opening PayPal…" : catalog.paypalCheckoutAvailable ? `Get ${pack.credits} credits` : "Checkout coming soon"}</button>
        </article>;
      })}</div>}
    </section>
    <section className="billing-reassurance"><div><span>SECURE, CLEAR, IN YOUR CONTROL</span><h2>A straightforward purchase, every time.</h2></div><ul><li>PayPal handles payment approval securely.</li><li>Credits are added only after payment confirmation.</li><li>Your recent purchases stay visible below.</li></ul></section>
    {catalog.recentCheckouts.length > 0 && <section className="billing-activity" aria-labelledby="billing-activity-title"><div className="billing-section-heading"><div><span>PAYMENT HISTORY</span><h2 id="billing-activity-title">Recent checkout activity</h2></div><p>Most recent first</p></div><div className="billing-checkout-list">{catalog.recentCheckouts.map((checkout) => <article key={checkout.id}><span className={`billing-checkout-mark is-${checkout.status}`}>{checkout.status === "paid" ? "✓" : "○"}</span><div><b>{checkout.creditPackSku ?? "Credit purchase"}</b><small>{formatDate(checkout.updatedAt)} · PayPal</small></div><strong>{price(checkout.amountCents, checkout.currency)}</strong><em className={`billing-checkout-status is-${checkout.status}`}>{checkoutLabel(checkout.status)}</em></article>)}</div></section>}
  </div>;
}
