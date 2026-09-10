import Image from "next/image";
import { SIGNUP_URL } from "@/lib/config";

const steps = [
  { n: "01", title: "Bring your design", text: "Drop in a sketch, model, or photo. Your geometry stays intact.", meta: "JPG · PNG · SKP · OBJ", icon: <><path d="M8 3v7m-3-3 3-3 3 3"/><path d="M3.5 11v2.5h9V11"/></> },
  { n: "02", title: "Direct the look", text: "Choose materials, mood, and light—or simply describe your vision.", meta: "Natural language controls", icon: <><path d="M4 12.5h8"/><path d="m5 10 5.8-5.8 1 1L6 11H5v-1Z"/><path d="m9.5 4.5 1 1"/></> },
  { n: "03", title: "Let Renvia render", text: "AI builds a photoreal result around the architecture—not over it.", meta: "Multiple views in seconds", icon: <><rect x="3" y="3" width="10" height="10" rx="2"/><path d="m5.5 10 2-2 1.5 1.5L10.5 8l2.5 2.5"/><circle cx="10.5" cy="5.5" r=".7" fill="currentColor" stroke="none"/></> },
  { n: "04", title: "Refine and deliver", text: "Compare, iterate, and export presentation-ready images your team can use.", meta: "High-resolution export", icon: <><path d="M3 8h10M8 3v10"/><path d="m10.5 5.5 2.5 2.5-2.5 2.5"/></> },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-16 overflow-hidden px-5 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto max-w-[1240px]">
        <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-end lg:gap-16">
          <div><span className="inline-flex items-center gap-2 rounded-full border border-hairline bg-surface px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[.16em] text-faint"><span className="h-1.5 w-1.5 rounded-full bg-blueprint" /> How it works</span><h2 className="mt-5 max-w-[560px] font-display text-4xl font-semibold leading-[.98] tracking-[-.05em] sm:text-[52px]">Your idea in.<br /><span className="text-[#aaa9a5]">A finished world out.</span></h2></div>
          <div className="flex flex-col gap-5 lg:items-end"><p className="max-w-[470px] text-sm leading-6 text-muted sm:text-[15px] sm:leading-7">Skip the rendering maze. Renvia turns the workflow into one clear, creative conversation—from first upload to client-ready visual.</p><a href={SIGNUP_URL} className="group inline-flex w-fit items-center gap-3 text-xs font-semibold text-primary">Start creating for free <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-white transition-transform group-hover:translate-x-1">→</span></a></div>
        </div>

        <div className="relative mt-12 overflow-hidden rounded-[22px] border border-[#282a2a] bg-[#181a1a] p-2 shadow-[0_36px_90px_-42px_rgba(17,19,19,.6)] sm:p-3">
          <div className="absolute left-[12%] top-0 h-px w-[76%] bg-gradient-to-r from-transparent via-white/30 to-transparent" />
          <div className="grid overflow-hidden rounded-[15px] border border-white/10 bg-[#202222] lg:grid-cols-[230px_1fr]">
            <div className="flex min-h-[420px] flex-col border-b border-white/10 p-5 lg:border-b-0 lg:border-r">
              <div className="flex items-center justify-between text-[9px] font-semibold uppercase tracking-[.15em] text-white/45"><span>Project brief</span><span className="h-1.5 w-1.5 rounded-full bg-[#74d99f] shadow-[0_0_10px_rgba(116,217,159,.7)]" /></div>
              <div className="mt-8 overflow-hidden rounded-xl border border-white/10 bg-white"><div className="relative aspect-[4/3]"><Image src="/hero/renvia-villa-sketch-clean.png" alt="Architectural villa drawing uploaded to Renvia" fill sizes="230px" className="object-cover" style={{ transform: "scale(.88) translate(2%, 4%)" }} /></div></div>
              <p className="mt-3 truncate text-[11px] font-medium text-white/75">villa-concept-03.png</p><p className="mt-1 text-[9px] text-white/35">2048 × 1536 · 4.8 MB</p>
              <div className="mt-7 space-y-2"><span className="text-[9px] font-semibold uppercase tracking-[.14em] text-white/35">Creative direction</span><div className="rounded-lg border border-white/10 bg-white/[.04] p-3 text-[10px] leading-5 text-white/65">Warm late-afternoon light, textured stone, quiet luxury, Mediterranean planting...</div></div>
              <div className="mt-auto pt-8"><div className="flex justify-between text-[9px] text-white/35"><span>Structure lock</span><span className="text-[#74d99f]">On</span></div><div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full w-full bg-[#74d99f]" /></div></div>
            </div>
            <div className="relative min-h-[420px] overflow-hidden sm:min-h-[520px]">
              <Image src="/hero/renvia-villa-premium.png" alt="Finished photorealistic Renvia villa render" fill sizes="(min-width:1024px) 790px, 100vw" className="object-cover" />
              <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/45 to-transparent" />
              <div className="absolute left-4 right-4 top-4 flex items-start justify-between sm:left-6 sm:right-6 sm:top-6"><div className="rounded-full border border-white/20 bg-black/25 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[.15em] text-white/80 backdrop-blur-md">Generated view · 01</div><div className="flex gap-1.5"><span className="h-2 w-2 rounded-full bg-white/25"/><span className="h-2 w-2 rounded-full bg-white/25"/><span className="h-2 w-2 rounded-full bg-white/90"/></div></div>
              <div className="absolute bottom-4 left-4 right-4 rounded-xl border border-white/20 bg-black/35 p-3 text-white shadow-xl backdrop-blur-md sm:bottom-6 sm:left-6 sm:right-auto sm:w-[310px] sm:p-4"><div className="flex items-center justify-between"><span className="text-[10px] font-semibold">Ready to present</span><span className="rounded-full bg-white/15 px-2 py-1 text-[8px] uppercase tracking-wider text-white/70">4K</span></div><p className="mt-1.5 text-[9px] leading-4 text-white/55">Geometry preserved · Materials applied · Lighting complete</p></div>
              <div className="how-scan absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent shadow-[0_0_18px_3px_rgba(255,255,255,.35)]" />
            </div>
          </div>
        </div>

        <div className="relative mt-4 grid gap-px overflow-hidden rounded-2xl border border-hairline bg-hairline sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => <article key={step.n} className="group relative min-h-[230px] bg-[#fdfdfc] p-5 transition-colors hover:bg-white sm:p-6">{index < steps.length - 1 && <span className="absolute -right-2 top-8 z-10 hidden h-4 w-4 rotate-45 border-r border-t border-hairline bg-[#fdfdfc] lg:block" />}<div className="flex items-center justify-between"><span className="font-mono text-[9px] text-faint">/{step.n}</span><span className="grid h-9 w-9 place-items-center rounded-full border border-hairline-strong bg-white text-primary shadow-sm transition group-hover:-translate-y-0.5 group-hover:border-primary"><svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">{step.icon}</svg></span></div><h3 className="mt-10 font-display text-base font-semibold tracking-[-.02em]">{step.title}</h3><p className="mt-2 text-xs leading-5 text-muted">{step.text}</p><p className="mt-5 border-t border-hairline pt-3 text-[9px] font-medium uppercase tracking-[.1em] text-faint">{step.meta}</p></article>)}
        </div>
      </div>
    </section>
  );
}
