import { SIGNUP_URL } from "@/lib/config";

const steps = [
  { n: "01", title: "Upload", text: "Upload up to 4 images, a 3D model, or a sketch.", icon: <path d="M8 5v6m-3-3 3-3 3 3M4 12v2h8v-2"/> },
  { n: "02", title: "Set the look", text: "Choose a style, materials, lighting, or describe it with a prompt.", icon: <><circle cx="8" cy="8" r="4"/><path d="M8 4v8M4 8h8"/></> },
  { n: "03", title: "Generate", text: "Renvia keeps your geometry and renders multiple views.", icon: <><rect x="4" y="4" width="8" height="8" rx="2"/><path d="m6 9 2-2 2 2 2-2"/></> },
  { n: "04", title: "Compare & refine", text: "Compare side-by-side, adjust the details, and export your favorites.", icon: <path d="m3 8 5-5 5 5-5 5-5-5Zm5-5v10"/> },
];

export function HowItWorks() {
  return <section id="how-it-works" className="px-5 py-24 sm:px-8 sm:py-32">
    <div className="mx-auto grid max-w-[1240px] gap-8 lg:grid-cols-[290px_1fr] lg:gap-12">
      <div className="lg:pr-7"><span className="rounded-full border border-hairline bg-surface px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[.16em] text-faint">How it works</span><h2 className="mt-5 font-display text-4xl font-semibold leading-[.98] tracking-[-.05em] sm:text-[48px]">From model to<br/>visualization.</h2><p className="mt-4 max-w-[280px] text-sm leading-6 text-muted">Four simple steps to polished renders — no complex tools required.</p><a href={SIGNUP_URL} className="mt-7 inline-flex rounded-lg bg-primary px-5 py-3 text-xs font-medium text-white">Start for free&nbsp; →</a></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{steps.map(s=><article key={s.n} className="flex min-h-[245px] flex-col rounded-xl border border-hairline bg-white p-5 shadow-[0_18px_45px_-36px_rgba(0,0,0,.45)]"><span className="font-mono text-[10px] text-faint">{s.n}</span><span className="mt-7 grid h-11 w-11 place-items-center rounded-xl border border-hairline-strong text-primary shadow-sm"><svg viewBox="0 0 16 16" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">{s.icon}</svg></span><h3 className="mt-7 text-sm font-semibold">{s.title}</h3><p className="mt-2 text-xs leading-5 text-muted">{s.text}</p></article>)}</div>
    </div>
  </section>;
}
