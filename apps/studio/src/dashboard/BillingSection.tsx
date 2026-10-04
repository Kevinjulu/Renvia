import { useEffect, useState } from "react";
import type { BillingCatalogResponse } from "@renvia/types";
import { ApiError } from "../lib/apiClient";

type StudioApi = {
  getBillingCatalog: () => Promise<BillingCatalogResponse>;
  createPaypalCheckout: (body: { kind: "credit_pack"; product: string; idempotencyKey: string }) => Promise<{ approvalUrl: string | null }>;
  capturePaypalCheckout: (id: string) => Promise<{ checkoutId: string; status: "paid" }>;
};

function price(cents: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);
}

/** Customer billing is read-only until a verified provider checkout is enabled. */
export function BillingSection({ api }: { api: StudioApi }) {
  const [catalog, setCatalog] = useState<BillingCatalogResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const buy = async (sku: string) => {
    setStarting(sku); setError(null);
    try { const checkout = await api.createPaypalCheckout({ kind: "credit_pack", product: sku, idempotencyKey: crypto.randomUUID() }); if (!checkout.approvalUrl) throw new Error("Checkout approval is unavailable"); window.location.assign(checkout.approvalUrl); }
    catch (reason) { setError(reason instanceof ApiError ? reason.detail ?? "Could not start checkout." : "Could not start checkout."); setStarting(null); }
  };

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(window.location.search);
    const checkoutId = params.get("checkout");
    const paypalResult = params.get("paypal");
    const resolveReturn = checkoutId && paypalResult === "return"
      ? api.capturePaypalCheckout(checkoutId).then(() => { if (active) setNotice("Payment confirmed. Your credits are ready to use."); })
      : Promise.resolve();
    if (checkoutId && paypalResult === "cancel") setNotice("Checkout was cancelled. No payment was taken.");
    resolveReturn
      .then(() => api.getBillingCatalog())
      .then((value) => { if (active) setCatalog(value); })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof ApiError ? reason.detail ?? "Could not confirm or load billing." : "Could not confirm or load billing.");
      });
    if (checkoutId) window.history.replaceState({}, "", window.location.pathname);
    return () => { active = false; };
  }, [api]);

  if (error) return <div className="feature-notice" role="alert">{error}</div>;
  if (!catalog) return <div className="feature-notice" role="status">Loading billing…</div>;

  return <>
    {notice && <div className="feature-notice" role="status">{notice}</div>}
    {!catalog.paypalCheckoutAvailable && <div className="feature-notice" role="status">Purchases are not enabled yet. Your plan and credit balance remain available while checkout is prepared.</div>}
    {catalog.creditPacks.length === 0 ? <div className="feature-notice">No credit packs are available yet.</div> : <div className="feature-plan-grid">{catalog.creditPacks.map((pack) => <article key={pack.sku} className="feature-plan"><p>Credit pack</p><h2>{pack.name}</h2><strong>{price(pack.priceCents, pack.currency)}</strong><span>{pack.credits} render credits. Price and credits are confirmed by Renvia at checkout.</span><button type="button" disabled={!catalog.paypalCheckoutAvailable || starting !== null} onClick={() => void buy(pack.sku)}>{starting === pack.sku ? "Opening PayPal…" : catalog.paypalCheckoutAvailable ? "Buy credits" : "Checkout coming soon"}</button></article>)}</div>}
    {catalog.recentCheckouts.length > 0 && <section className="feature-form-card"><h2>Recent checkout activity</h2>{catalog.recentCheckouts.map((checkout) => <p key={checkout.id}><b>{checkout.creditPackSku ?? "Purchase"}</b> · {checkout.status} · {price(checkout.amountCents, checkout.currency)}</p>)}</section>}
  </>;
}
