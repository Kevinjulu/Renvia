import { useMemo } from "react";
import type { BillingCatalogResponse, CreditPack, PaymentMethod } from "@renvia/types";
import { packOutcome } from "./billingPresentation";
import { formatPrice, type CheckoutItem } from "./CheckoutDialog";

/** The payment methods switched on for one-time purchases. */
export function packMethodsFor(catalog: BillingCatalogResponse): PaymentMethod[] {
  return (Object.keys(catalog.paymentMethods) as PaymentMethod[]).filter((method) => catalog.paymentMethods[method]);
}

/** One-time credit packs, shared by the Billing page and the plans popup. */
export function CreditPacksGrid({ catalog, standardCost, onChoose }: { catalog: BillingCatalogResponse; standardCost: number; onChoose: (item: CheckoutItem) => void }) {
  const methods = useMemo(() => packMethodsFor(catalog), [catalog]);
  const bestValueSku = useMemo(() => {
    if (catalog.creditPacks.length < 2) return null;
    return catalog.creditPacks.reduce((best, pack) => (pack.priceCents / pack.credits < best.priceCents / best.credits ? pack : best)).sku;
  }, [catalog]);
  const anyMethod = methods.length > 0;
  const buy = (pack: CreditPack) => onChoose({ kind: "credit_pack", product: pack.sku, name: pack.name, usdCents: pack.priceCents, methods });

  if (catalog.creditPacks.length === 0) {
    return (
      <div className="billing-empty">
        <p className="billing-empty-title">No credit packs available yet</p>
        <p>Check back soon — new packs will appear here.</p>
      </div>
    );
  }

  return (
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
            <button type="button" disabled={!anyMethod} onClick={() => buy(pack)}>
              {anyMethod ? "Buy credits" : "Checkout coming soon"}
            </button>
          </article>
        );
      })}
    </div>
  );
}
