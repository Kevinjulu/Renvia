import { useState } from "react";
import type { BillingCatalogResponse, BillingInterval, BillingPlanOffer, MeResponse, PaymentMethod } from "@renvia/types";
import { websiteUrl } from "../lib/websiteLinks";
import type { CheckoutItem } from "./CheckoutDialog";
import { formatPrice } from "./CheckoutDialog";

const FREE_SLUG = "starter";
/** The plan shown as the best deal: the top paid tier. */
const FEATURED_SLUG = "team";

/** What each tier unlocks beyond its numbers. Kept in step with Studio Control's per-plan switches. */
const TIER_FEATURES: Record<string, string[]> = {
  starter: ["Renders and edits stay in the Studio", "Watermarked previews"],
  studio: ["Download clean, watermark-free files", "Standard and 4K output", "Before & after exports"],
  team: ["Download clean, watermark-free files", "Standard, 4K and 8K output", "Before & after exports"],
};

function limits(plan: BillingPlanOffer): string[] {
  const rows = [`${plan.monthlyCredits.toLocaleString()} credits every month`];
  if (plan.maxProjects) rows.push(`Up to ${plan.maxProjects.toLocaleString()} projects`);
  if (plan.concurrentRenderLimit) rows.push(plan.concurrentRenderLimit === 1 ? "One render at a time" : `${plan.concurrentRenderLimit} renders at once`);
  if (plan.dailyRenderLimit) rows.push(`Up to ${plan.dailyRenderLimit.toLocaleString()} renders a day`);
  return rows;
}

function payableMethods(plan: BillingPlanOffer, interval: BillingInterval): PaymentMethod[] {
  return (Object.keys(plan.payable) as PaymentMethod[]).filter((method) => plan.payable[method].includes(interval));
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path d="m2.5 6.2 2.3 2.3 4.7-5" />
    </svg>
  );
}

export function PlansSection({
  catalog,
  me,
  onChoose,
  highlight = null,
  variant = "page",
}: {
  catalog: BillingCatalogResponse;
  me: MeResponse | null;
  onChoose: (item: CheckoutItem) => void;
  /** The plan that unlocks what the user just tried, marked instead of the usual best value. */
  highlight?: string | null;
  /** In the Studio's plans popup: no heading or Enterprise card, just the plans to choose from. */
  variant?: "page" | "dialog";
}) {
  const inDialog = variant === "dialog";
  const entitlement = me?.entitlement ?? null;
  const [interval, setBillingInterval] = useState<BillingInterval>(entitlement?.billingInterval ?? "month");
  const plans = catalog.plans;
  const yearlySold = plans.some((plan) => plan.yearlyPriceCents !== null && plan.priceCents > 0);
  const currentSlug = entitlement?.plan.slug ?? null;
  const currentInterval = entitlement?.billingInterval ?? null;
  const currentPrice = plans.find((plan) => plan.slug === currentSlug)?.priceCents ?? 0;
  const contact = catalog.salesContactEmail
    ? `mailto:${catalog.salesContactEmail}?subject=${encodeURIComponent("Ramah Studio Enterprise")}`
    : websiteUrl("/pricing#pricing", "signed-in");

  return (
    <section className={`billing-section ${inDialog ? "is-dialog" : ""}`} id={inDialog ? undefined : "plans"} aria-labelledby={inDialog ? undefined : "plans-title"} aria-label={inDialog ? "Plans" : undefined}>
      <header className="billing-section-heading plans-heading">
        {inDialog ? (
          <p className="plans-dialog-lead">Every plan includes the full Studio. Paid plans add monthly credits, clean downloads and higher resolutions.</p>
        ) : (
          <div>
            <h2 id="plans-title">Plans</h2>
            <p>Every plan includes the full Studio. Paid plans add monthly credits, clean downloads and higher limits.</p>
          </div>
        )}
        {yearlySold && (
          <div className="plans-interval" role="radiogroup" aria-label="Billing period">
            <button type="button" role="radio" aria-checked={interval === "month"} className={interval === "month" ? "is-active" : ""} onClick={() => setBillingInterval("month")}>
              Monthly
            </button>
            <button type="button" role="radio" aria-checked={interval === "year"} className={interval === "year" ? "is-active" : ""} onClick={() => setBillingInterval("year")}>
              Yearly <em>2 months free</em>
            </button>
          </div>
        )}
      </header>

      <div className={`plans-grid ${inDialog ? "is-dialog" : ""}`}>
        {plans.map((plan) => {
          const free = plan.slug === FREE_SLUG || plan.priceCents === 0;
          const featured = plan.slug === (highlight ?? FEATURED_SLUG);
          const yearly = interval === "year" && plan.yearlyPriceCents !== null && !free;
          const shownCents = yearly ? Math.round(plan.yearlyPriceCents! / 12) : plan.priceCents;
          const isCurrent = plan.slug === currentSlug && (free || currentInterval === null || currentInterval === interval);
          const methods = free ? [] : payableMethods(plan, interval);
          const upgrade = !free && plan.priceCents > currentPrice;

          let action: { label: string; disabled: boolean; onClick?: () => void };
          if (free) action = { label: currentSlug === plan.slug ? "Your plan" : "Included", disabled: true };
          else if (isCurrent && entitlement?.autoRenews) action = { label: "Your plan", disabled: true };
          else if (methods.length === 0) action = { label: interval === "year" && plan.yearlyPriceCents === null ? "Monthly only" : "Coming soon", disabled: true };
          else {
            const usdCents = yearly ? plan.yearlyPriceCents! : plan.priceCents;
            action = {
              label: isCurrent ? "Renew" : currentSlug && currentSlug !== FREE_SLUG ? (upgrade ? `Upgrade to ${plan.name}` : `Switch to ${plan.name}`) : "Subscribe",
              disabled: false,
              onClick: () => onChoose({ kind: "subscription", product: plan.slug, name: `${plan.name} · ${yearly ? "Yearly" : "Monthly"}`, interval, usdCents, methods, cardAutoRenews: plan.cardAutoRenews[interval] }),
            };
          }

          return (
            <article key={plan.slug} className={`plan-card ${featured ? "is-featured" : ""} ${isCurrent ? "is-current" : ""}`}>
              {featured && <span className="billing-pack-badge">{highlight ? "Unlocks this" : "Best value"}</span>}
              <h3>{plan.name}</h3>
              <p className="plan-description">{plan.description}</p>
              <div className="plan-price">
                <strong>{formatPrice(shownCents, plan.currency)}</strong>
                <span>{free ? "forever" : "per month"}</span>
              </div>
              <p className="plan-billing">
                {free
                  ? "No card needed"
                  : yearly
                    ? `${formatPrice(plan.yearlyPriceCents!, plan.currency)} billed once a year`
                    : interval === "year" && plan.yearlyPriceCents === null
                      ? "Billed monthly"
                      : "Billed monthly · cancel any time"}
              </p>
              <button type="button" className="plan-action" disabled={action.disabled} onClick={action.onClick}>
                {action.label}
              </button>
              <p className="plan-includes">This includes</p>
              <ul>
                {[...limits(plan), ...(TIER_FEATURES[plan.slug] ?? [])].map((feature) => (
                  <li key={feature}>
                    <CheckIcon />
                    {feature}
                  </li>
                ))}
              </ul>
            </article>
          );
        })}

        {!inDialog && (
        <article className="plan-card is-enterprise">
          <h3>Enterprise</h3>
          <p className="plan-description">For studios and teams of five or more.</p>
          <div className="plan-price">
            <strong>Custom</strong>
          </div>
          <p className="plan-billing">Annual agreement, invoiced</p>
          <a className="plan-action" href={contact} target={catalog.salesContactEmail ? undefined : "_blank"} rel="noreferrer">
            Contact us
          </a>
          <p className="plan-includes">Everything in Premium, plus</p>
          <ul>
            {["Credit volume sized to your team", "Centralised billing and invoices", "Onboarding and training", "Dedicated support"].map((feature) => (
              <li key={feature}>
                <CheckIcon />
                {feature}
              </li>
            ))}
          </ul>
        </article>
        )}
      </div>
    </section>
  );
}
