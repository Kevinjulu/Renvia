import { SIGNUP_URL } from "@/lib/config";

const TIERS = [
  {
    name: "Starter",
    description: "Explore the workflow and bring your first ideas to life.",
    price: "$0",
    period: "/month",
    billing: "Free forever",
    features: ["5 renders / month", "720p exports", "Community support", "1 project"],
    cta: "Start creating",
    emphasized: false,
  },
  {
    name: "Studio",
    description: "The complete workspace for professionals creating every day.",
    price: "$29",
    period: "/month",
    billing: "Billed monthly",
    features: ["200 renders / month", "4K exports", "Priority render queue", "Unlimited projects", "Email support"],
    cta: "Start free trial",
    emphasized: true,
  },
  {
    name: "Enterprise",
    description: "Flexible scale, control, and support for ambitious teams.",
    price: "Let’s talk",
    period: "",
    billing: "Custom pricing",
    features: ["Custom render volume", "Team collaboration", "Private storage", "Dedicated support", "SLA & security"],
    cta: "Contact sales",
    emphasized: false,
  },
];

function CheckIcon({ inverse = false }: { inverse?: boolean }) {
  return <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full ${inverse ? "bg-white/10 text-white" : "bg-[#edf7f0] text-[#3e8a58]"}`}><svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="m2 5 2 2 4-4" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" /></svg></span>;
}

export function Pricing() {
  return (
    <section id="pricing" className="overflow-hidden bg-[#121414] px-5 py-24 text-white sm:px-8 sm:py-32">
      <div className="mx-auto max-w-[1240px]">
        <div className="grid gap-8 lg:grid-cols-[1.15fr_.85fr] lg:items-end lg:gap-16">
          <h2 className="max-w-[700px] font-display text-[42px] font-semibold leading-[.96] tracking-[-.055em] sm:text-[58px]">
            Start with an idea.
            <span className="block text-white/38">Scale with the work.</span>
          </h2>
          <div className="lg:justify-self-end"><p className="max-w-[440px] text-sm leading-7 text-white/55 sm:text-[15px]">Simple plans for first experiments, daily professional practice, and teams producing at scale.</p><p className="mt-4 text-[10px] font-medium uppercase tracking-[.15em] text-white/30">Choose the plan that fits how you create</p></div>
        </div>

        <div className="mt-14 grid items-stretch gap-3 lg:grid-cols-[.82fr_1.18fr_.82fr] lg:gap-4">
          {TIERS.map((tier) => {
            const highlighted = tier.emphasized;
            return (
              <article key={tier.name} className={`relative flex min-h-[520px] flex-col overflow-hidden rounded-[22px] border p-6 sm:p-8 ${highlighted ? "border-white bg-[#f7f6f2] text-primary shadow-[0_35px_90px_-38px_rgba(0,0,0,.8)] lg:-translate-y-4" : "border-white/10 bg-white/[.035] text-white"}`}>
                {highlighted && <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#2f6fed] via-[#76a0ff] to-[#2f6fed]" />}
                <div className="flex items-center justify-between"><p className={`text-[10px] font-semibold uppercase tracking-[.16em] ${highlighted ? "text-primary" : "text-white/65"}`}>{tier.name}</p>{highlighted && <span className="rounded-full bg-primary px-3 py-1.5 text-[8px] font-semibold uppercase tracking-[.13em] text-white">Recommended</span>}</div>
                <p className={`mt-5 max-w-[320px] text-xs leading-5 ${highlighted ? "text-muted" : "text-white/45"}`}>{tier.description}</p>

                <div className="mt-10 flex items-end gap-2"><span className={`font-display font-semibold leading-none tracking-[-.055em] ${tier.name === "Enterprise" ? "text-[42px]" : "text-[58px] sm:text-[66px]"}`}>{tier.price}</span>{tier.period && <span className={`mb-1.5 text-xs ${highlighted ? "text-faint" : "text-white/35"}`}>{tier.period}</span>}</div>
                <p className={`mt-2 text-[10px] ${highlighted ? "text-faint" : "text-white/30"}`}>{tier.billing}</p>

                <div className={`my-8 h-px ${highlighted ? "bg-hairline" : "bg-white/10"}`} />
                <p className={`text-[9px] font-semibold uppercase tracking-[.14em] ${highlighted ? "text-faint" : "text-white/30"}`}>{highlighted ? "Everything you need to create" : "Plan includes"}</p>
                <ul className="mt-5 space-y-3.5">{tier.features.map((feature) => <li key={feature} className={`flex items-center gap-3 text-xs ${highlighted ? "text-secondary" : "text-white/60"}`}><CheckIcon inverse={!highlighted} />{feature}</li>)}</ul>

                <a href={tier.name === "Enterprise" ? "#" : SIGNUP_URL} className={`group mt-auto flex h-12 items-center justify-between rounded-full px-5 text-xs font-semibold transition ${highlighted ? "bg-primary text-white shadow-[0_10px_26px_-14px_rgba(0,0,0,.75)] hover:bg-black" : "border border-white/15 bg-white/[.04] text-white hover:bg-white/10"}`}>{tier.cta}<span className="transition-transform group-hover:translate-x-1">→</span></a>
              </article>
            );
          })}
        </div>

        <div className="mt-4 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-3">
          <div className="bg-[#121414] px-5 py-4 text-[10px] text-white/45"><span className="mr-2 text-white/80">01</span> Begin free and learn the workflow</div>
          <div className="bg-[#121414] px-5 py-4 text-[10px] text-white/45"><span className="mr-2 text-white/80">02</span> Move up when projects demand more</div>
          <div className="bg-[#121414] px-5 py-4 text-[10px] text-white/45"><span className="mr-2 text-white/80">03</span> Talk to us when your whole team is ready</div>
        </div>
      </div>
    </section>
  );
}
