import { useEffect, useRef, useState } from "react";
import type { BillingCatalogResponse, BillingInterval, CreateCheckoutRequest, CreateCheckoutResponse, PaymentMethod } from "@renvia/types";
import { ApiError } from "../lib/apiClient";

/** What the customer is about to pay for. Prices are the server's; this only displays them. */
export type CheckoutItem =
  | { kind: "subscription"; product: string; name: string; interval: BillingInterval; usdCents: number; methods: PaymentMethod[]; cardAutoRenews: boolean }
  | { kind: "credit_pack"; product: string; name: string; usdCents: number; methods: PaymentMethod[] };

const METHOD_ORDER: PaymentMethod[] = ["card", "mpesa", "paypal"];

const METHOD_LABEL: Record<PaymentMethod, { title: string; detail: string }> = {
  card: { title: "Card", detail: "Visa or Mastercard, through Paystack" },
  mpesa: { title: "M-Pesa", detail: "Approve the prompt on your phone, through Paystack" },
  paypal: { title: "PayPal", detail: "Your PayPal balance or a card saved in PayPal" },
};

export function formatPrice(cents: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
}

/** What M-Pesa charges for a USD price: whole shillings at the server's rate, as the API computes it. */
function shillings(usdCents: number, rate: number) {
  return Math.round((usdCents / 100) * rate) * 100;
}

const RETURN_KEY = "renvia.checkoutReturn";

/** Remembers the Studio page a checkout started from; payment providers always return to Billing. */
function rememberCheckoutReturn(path: string | undefined) {
  try {
    if (path && path.startsWith("/") && !path.startsWith("//")) sessionStorage.setItem(RETURN_KEY, path);
    else sessionStorage.removeItem(RETURN_KEY);
  } catch {
    // Storage blocked: Billing just won't offer the way back.
  }
}

/** The page to offer going back to after a checkout, read once. */
export function takeCheckoutReturn(): string | null {
  try {
    const path = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    return path && path.startsWith("/") && !path.startsWith("//") && path !== "/billing" ? path : null;
  } catch {
    return null;
  }
}

function renewalNote(item: CheckoutItem, method: PaymentMethod): string {
  if (item.kind === "credit_pack") return "One payment. The credits never expire.";
  const period = item.interval === "year" ? "year" : "month";
  if (method === "paypal" || (method === "card" && item.cardAutoRenews)) return `Renews every ${period} until you cancel. Cancel any time from Billing.`;
  return `Pays for one ${period}. It doesn't renew on its own; renew from Billing before it ends.`;
}

export function CheckoutDialog({
  item,
  catalog,
  createCheckout,
  onClose,
  returnTo,
}: {
  item: CheckoutItem;
  catalog: BillingCatalogResponse;
  createCheckout: (body: CreateCheckoutRequest) => Promise<CreateCheckoutResponse>;
  onClose: () => void;
  /** The Studio page to offer going back to once the payment settles on Billing. */
  returnTo?: string;
}) {
  const methods = METHOD_ORDER.filter((method) => item.methods.includes(method));
  const [method, setMethod] = useState<PaymentMethod | null>(methods[0] ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per dialog, so a double click or a retry after a network error can't open two checkouts.
  const idempotencyKey = useRef(crypto.randomUUID());
  const continueRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    continueRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const pay = async () => {
    if (!method) return;
    setBusy(true);
    setError(null);
    try {
      const checkout = await createCheckout({
        kind: item.kind,
        product: item.product,
        ...(item.kind === "subscription" ? { interval: item.interval } : {}),
        method,
        idempotencyKey: idempotencyKey.current,
      });
      if (!checkout.approvalUrl) throw new Error("The payment page isn't available");
      rememberCheckoutReturn(returnTo);
      window.location.assign(checkout.approvalUrl);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.detail ?? "Couldn't start the payment. Try again." : "Couldn't start the payment. Try again.");
      idempotencyKey.current = crypto.randomUUID();
      setBusy(false);
    }
  };

  const period = item.kind === "subscription" ? (item.interval === "year" ? " / year" : " / month") : "";

  return (
    <div className="checkout-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <div className="checkout-dialog" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
        <header>
          <div>
            <p className="checkout-eyebrow">{item.kind === "subscription" ? "Subscribe" : "Top up credits"}</p>
            <h2 id="checkout-title">{item.name}</h2>
            <p className="checkout-price">
              <strong>{formatPrice(item.usdCents, "USD")}</strong>
              {period && <span>{period}</span>}
            </p>
          </div>
          <button type="button" className="checkout-close" onClick={onClose} disabled={busy} aria-label="Close">
            <svg viewBox="0 0 14 14" aria-hidden="true">
              <path d="M3 3l8 8M11 3l-8 8" />
            </svg>
          </button>
        </header>

        {methods.length === 0 ? (
          <p className="checkout-empty">Payments aren't switched on yet. Check back soon.</p>
        ) : (
          <>
            <p className="checkout-label" id="checkout-methods">Pay with</p>
            <div className="checkout-methods" role="radiogroup" aria-labelledby="checkout-methods">
              {methods.map((option) => (
                <button key={option} type="button" role="radio" aria-checked={method === option} className={method === option ? "is-active" : ""} onClick={() => setMethod(option)} disabled={busy}>
                  <span className={`checkout-method-mark is-${option}`} aria-hidden="true">
                    {option === "card" ? "▭" : option === "mpesa" ? "M" : "P"}
                  </span>
                  <span className="checkout-method-text">
                    <strong>{METHOD_LABEL[option].title}</strong>
                    <small>{METHOD_LABEL[option].detail}</small>
                  </span>
                  {(option === "mpesa" || (option === "card" && catalog.cardCurrency === "KES")) && catalog.kesPerUsd && <b>{formatPrice(shillings(item.usdCents, catalog.kesPerUsd), "KES")}</b>}
                </button>
              ))}
            </div>
            {method && <p className="checkout-note">{renewalNote(item, method)}</p>}
            {method && method !== "paypal" && (
              <p className="checkout-note is-quiet">
                {method === "card" && catalog.cardCurrency === "USD" ? "Charged in US dollars." : "Charged in Kenyan shillings."} You'll confirm the amount on Paystack's secure page.
              </p>
            )}
          </>
        )}

        {error && <p className="checkout-error" role="alert">{error}</p>}

        <footer>
          <button type="button" className="checkout-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button ref={continueRef} type="button" className="checkout-primary" onClick={() => void pay()} disabled={!method || busy}>
            {busy ? "Opening secure checkout…" : method ? `Continue with ${METHOD_LABEL[method].title}` : "Unavailable"}
          </button>
        </footer>
      </div>
    </div>
  );
}
