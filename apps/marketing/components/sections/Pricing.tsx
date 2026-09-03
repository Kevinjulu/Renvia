import { SIGNUP_URL } from "@/lib/config";

const TIERS = [
  {
    name: "Starter",
    description: "For exploring and trying out Renvia.",
    price: "$0",
    period: "/month",
    billing: "Free forever",
    features: ["5 renders / month", "720p exports", "Community support", "1 project"],
    cta: "Get started",
    emphasized: false,
  },
  {
    name: "Studio",
    description: "For professionals and daily use.",
    price: "$29",
    period: "/month",
    billing: "Billed monthly",
    features: ["200 renders / month", "4K exports", "Priority render queue", "Unlimited projects", "Email support"],
    cta: "Start free trial",
    emphasized: true,
  },
  {
    name: "Enterprise",
    description: "For teams with advanced needs.",
    price: "Let's talk",
    period: "",
    billing: "Custom pricing",
    features: ["Custom render volume", "Team collaboration", "Private storage", "Dedicated support", "SLA & security"],
    cta: "Contact sales",
    emphasized: false,
  },
];

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="mt-0.5 shrink-0 text-primary">
      <path d="M3 7.5 6 10.5 11 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Pricing() {
  return (
    <section id="pricing" className="border-t border-hairline px-6 py-20 sm:py-24">
      <div className="mx-auto max-w-content">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-4 lg:gap-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-secondary">Pricing</p>
            <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-primary sm:text-4xl">
              Simple pricing.
              <br />
              Built for creators.
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-muted">Start free. Scale when you need more.</p>
            <a
              href="#features"
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-primary underline decoration-hairline-strong underline-offset-4 transition-colors hover:decoration-primary"
            >
              Compare features
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M3 6h6M6 3l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </div>

          {TIERS.map((tier) => (
            <div
              key={tier.name}
              className={`relative rounded-lg border bg-surface p-6 ${tier.emphasized ? "border-hairline-strong" : "border-hairline"}`}
            >
              {tier.emphasized && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-primary px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-white">
                  Most popular
                </span>
              )}

              <p className="text-xs font-semibold uppercase tracking-wide text-primary">{tier.name}</p>
              <p className="mt-2 text-xs leading-relaxed text-muted">{tier.description}</p>

              <div className="mt-5 flex items-baseline gap-1">
                <span className="font-display text-2xl font-semibold text-primary">{tier.price}</span>
                {tier.period && <span className="text-xs text-muted">{tier.period}</span>}
              </div>
              <p className="mt-1 text-xs text-faint">{tier.billing}</p>

              <ul className="mt-5 flex flex-col gap-2.5">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-xs text-muted">
                    <CheckIcon />
                    {feature}
                  </li>
                ))}
              </ul>

              <a
                href={tier.name === "Enterprise" ? "#" : SIGNUP_URL}
                className={
                  tier.emphasized
                    ? "mt-6 block rounded-md bg-primary px-4 py-2.5 text-center text-xs font-medium text-white transition-opacity hover:opacity-90"
                    : "mt-6 block rounded-md border border-hairline bg-white px-4 py-2.5 text-center text-xs font-medium text-primary transition-colors hover:border-primary/30"
                }
              >
                {tier.cta}
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
