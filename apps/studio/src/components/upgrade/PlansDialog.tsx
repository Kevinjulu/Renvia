import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { BillingCatalogResponse } from "@renvia/types";
import { ApiError, useApiClient } from "../../lib/apiClient";
import { creditPricesFor } from "../../lib/creditPrices";
import { useAccountStore } from "../../lib/useAccountStore";
import { useFocusTrap } from "../../lib/useFocusTrap";
import { useUpgradeDialogStore, type PlansTab } from "../../lib/useUpgradeDialog";
import { CheckoutDialog, type CheckoutItem } from "../../dashboard/CheckoutDialog";
import { CreditPacksGrid } from "../../dashboard/CreditPacksGrid";
import { PlansSection } from "../../dashboard/PlansSection";

/**
 * Plans and credit packs in a popup over the Studio, with checkout on top. Paying still goes
 * through the provider's page and back to Billing, which confirms it and links back here.
 */
export function PlansDialog() {
  const plans = useUpgradeDialogStore((state) => state.plans);
  const closePlans = useUpgradeDialogStore((state) => state.closePlans);
  const me = useAccountStore((state) => state.me);
  const api = useApiClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [catalog, setCatalog] = useState<BillingCatalogResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<PlansTab>("plans");
  const [checkout, setCheckout] = useState<CheckoutItem | null>(null);
  const open = plans !== null;
  const dialogRef = useFocusTrap<HTMLDivElement>(open && checkout === null, ".plans-dialog-close");

  const load = useCallback(() => {
    setError(null);
    api
      .getBillingCatalog()
      .then(setCatalog)
      .catch((reason: unknown) => setError(reason instanceof ApiError && reason.detail ? reason.detail : "Couldn't load plans. Check your connection and try again."));
  }, [api]);

  // Fresh prices and plan state each time it opens, on the tab the caller asked for.
  useEffect(() => {
    if (!open) return;
    setTab(plans?.tab ?? "plans");
    setCheckout(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, load]);

  useEffect(() => {
    if (!open || checkout) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePlans();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, checkout, closePlans]);

  if (!plans) return null;
  const planName = me?.entitlement.plan.name ?? "Free";
  const credits = me?.creditBalance ?? 0;

  return (
    <>
      <div className="plans-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closePlans()}>
        <div ref={dialogRef} className="plans-dialog" role="dialog" aria-modal="true" aria-labelledby="plans-dialog-title">
          <header className="plans-dialog-header">
            <div>
              <p className="plans-dialog-eyebrow">
                You're on <b>{planName}</b> · {credits} {credits === 1 ? "credit" : "credits"} left
              </p>
              <h2 id="plans-dialog-title">{tab === "plans" ? "Upgrade your plan" : "Top up credits"}</h2>
            </div>
            <button type="button" className="plans-dialog-close" onClick={closePlans} aria-label="Close">
              <svg viewBox="0 0 14 14" aria-hidden="true">
                <path d="M3 3l8 8M11 3l-8 8" />
              </svg>
            </button>
          </header>

          <div className="plans-dialog-tabs" role="tablist" aria-label="What to buy">
            <button type="button" role="tab" aria-selected={tab === "plans"} className={tab === "plans" ? "is-active" : ""} onClick={() => setTab("plans")}>
              Plans
            </button>
            <button type="button" role="tab" aria-selected={tab === "credits"} className={tab === "credits" ? "is-active" : ""} onClick={() => setTab("credits")}>
              Credit packs
            </button>
          </div>

          <div className="plans-dialog-body">
            {error ? (
              <div className="plans-dialog-state" role="alert">
                <p>{error}</p>
                <button type="button" className="plan-action" onClick={load}>
                  Try again
                </button>
              </div>
            ) : !catalog ? (
              <div className="plans-dialog-state" role="status" aria-label="Loading plans">
                <div className="plans-dialog-skeleton">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div key={index} className="billing-skeleton is-pack" />
                  ))}
                </div>
              </div>
            ) : tab === "plans" ? (
              <PlansSection catalog={catalog} me={me} onChoose={setCheckout} highlight={plans.highlight} variant="dialog" />
            ) : (
              <>
                <p className="plans-dialog-lead">One-time purchases. Credits are added once payment is confirmed and never expire.</p>
                <CreditPacksGrid catalog={catalog} standardCost={creditPricesFor(me).render} onChoose={setCheckout} />
              </>
            )}
          </div>

          <footer className="plans-dialog-footer">
            <span>Pay by card, M-Pesa or PayPal on a secure checkout page. Cancel any time.</span>
            <button
              type="button"
              onClick={() => {
                closePlans();
                navigate("/billing");
              }}
            >
              Billing & payment history
            </button>
          </footer>
        </div>
      </div>
      {checkout && catalog && (
        <CheckoutDialog item={checkout} catalog={catalog} createCheckout={api.createCheckout} onClose={() => setCheckout(null)} returnTo={`${location.pathname}${location.search}`} />
      )}
    </>
  );
}
