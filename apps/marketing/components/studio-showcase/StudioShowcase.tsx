import Image from "next/image";
import { STUDIO_URL } from "@/lib/config";

const proof = [
  {
    number: "01",
    title: "Every view, one project",
    text: "Work across front, side, and rear elevations without losing the design thread.",
  },
  {
    number: "02",
    title: "Creative control, built in",
    text: "Shape style, resolution, references, and structure from one focused workspace.",
  },
  {
    number: "03",
    title: "From drawing to decision",
    text: "Generate, compare, refine, and present—without jumping between tools.",
  },
];

export function StudioShowcase() {
  return (
    <section className="overflow-hidden bg-[#f3f2ef] px-5 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto max-w-[1400px]">
        <div className="mx-auto max-w-[820px] text-center">
          <h2 className="font-display text-[42px] font-semibold leading-[.96] tracking-[-.055em] text-primary sm:text-[58px] lg:text-[68px]">
            A studio that feels like yours.
            <span className="mt-2 block text-[#aaa9a5]">Because it is.</span>
          </h2>
          <p className="mx-auto mt-6 max-w-[640px] text-sm leading-7 text-muted sm:text-base">
            One calm, considered workspace for the whole visualization process. Your elevations, direction, references, and results stay exactly where the work happens.
          </p>
        </div>

        <div className="relative mt-14 sm:mt-20">
          <div className="absolute -inset-x-20 -inset-y-16 -z-0 bg-[radial-gradient(ellipse_at_center,rgba(47,111,237,.12),transparent_62%)]" />
          {/* The image carries its own device frame and scene, so it sits unframed here. */}
          <div className="relative z-10 aspect-[1672/941] overflow-hidden rounded-[18px] border border-black/10 bg-[#e9e7e2] shadow-[0_55px_110px_-52px_rgba(20,20,18,.68)] sm:rounded-[26px]">
            <Image
              src="/studio/renvia-studio-showcase.webp"
              alt="Renvia Studio comparing a front elevation before and after a photorealistic render, with style, prompt and reference image controls on the left and render history on the right"
              fill
              sizes="(min-width: 1440px) 1400px, 100vw"
              className="object-cover"
              priority={false}
            />
          </div>
        </div>

        <div className="mt-12 grid border-y border-black/10 sm:mt-16 lg:grid-cols-3">
          {proof.map((item, index) => (
            <article key={item.number} className={`py-7 lg:px-8 lg:py-9 ${index > 0 ? "border-t border-black/10 lg:border-l lg:border-t-0" : ""}`}>
              <div className="flex items-start gap-5">
                <span className="pt-1 font-mono text-[9px] text-faint">{item.number}</span>
                <div><h3 className="font-display text-base font-semibold tracking-[-.025em]">{item.title}</h3><p className="mt-2 max-w-[330px] text-xs leading-5 text-muted">{item.text}</p></div>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-6 sm:flex-row">
          <p className="text-center text-[11px] text-faint sm:text-left">This is Renvia Studio—not a mockup. What you see is what you work in.</p>
          <a href={STUDIO_URL} className="group inline-flex h-12 items-center gap-3 rounded-full bg-primary px-6 text-xs font-semibold text-white shadow-[0_10px_25px_-14px_rgba(0,0,0,.7)] transition hover:-translate-y-0.5 hover:bg-black">
            Open Renvia Studio <span className="transition-transform group-hover:translate-x-1">→</span>
          </a>
        </div>
      </div>
    </section>
  );
}
