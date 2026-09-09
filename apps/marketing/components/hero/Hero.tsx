import Image from "next/image";
import { CompareSlider } from "@/components/compare-slider/CompareSlider";
import { SIGNUP_URL } from "@/lib/config";

const proof = ["Keep original geometry", "Photorealistic results", "Built for design teams"];

export function Hero() {
  return (
    <section className="overflow-hidden px-5 pb-16 pt-28 sm:px-8 sm:pb-24 sm:pt-36">
      <div className="mx-auto max-w-[1400px]">
        <div className="grid items-center gap-12 lg:min-h-[610px] lg:grid-cols-[0.82fr_1.18fr] lg:gap-16">
          <div className="animate-rise-in">
            <span className="inline-flex rounded-full border border-hairline bg-surface px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-secondary">AI for architects &amp; creatives</span>
            <h1 className="mt-5 font-display text-[48px] font-semibold leading-[0.96] tracking-[-0.058em] text-primary sm:text-6xl lg:text-[72px] xl:text-[80px]">Change the finish,<span className="block text-[#b8b8b5]">not the floor plan.</span></h1>
            <p className="mt-6 max-w-[570px] text-[15px] leading-7 text-muted sm:text-base">Turn sketches, 3D models, or photos into beautiful, photorealistic renders — while keeping your exact geometry. Explore materials, lighting, and styles in seconds.</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href={SIGNUP_URL} className="inline-flex h-12 items-center gap-3 rounded-lg bg-[#111315] px-6 text-sm font-medium text-white shadow-[0_8px_24px_-12px_rgba(0,0,0,.7)] transition hover:-translate-y-0.5 hover:bg-black">Start generating <span aria-hidden="true">→</span></a>
              <a href="#how-it-works" className="inline-flex h-12 items-center gap-3 rounded-lg border border-hairline-strong bg-white px-6 text-sm font-medium text-primary transition hover:bg-surface"><span className="text-[11px]">▶</span> Watch demo</a>
            </div>
            <div className="mt-7 flex flex-wrap gap-x-6 gap-y-3">{proof.map((label) => <span key={label} className="flex items-center gap-2 text-[11px] text-faint"><span className="grid h-4 w-4 place-items-center rounded-full border border-hairline-strong text-[9px]">✓</span>{label}</span>)}</div>
          </div>
          <div className="relative animate-rise-in lg:translate-y-2">
            <div className="absolute -inset-16 -z-10 bg-[radial-gradient(circle,rgba(219,217,210,.42),transparent_66%)]" />
            <CompareSlider before={<div className="relative h-full w-full bg-white"><Image src="/hero/renvia-villa-sketch-clean.png" alt="Clean architectural model drawing without landscaping" fill priority sizes="(min-width:1024px) 60vw,100vw" className="object-cover" style={{ transform: "scale(.88) translate(2%, 4%)" }} /></div>} after={<div className="relative h-full w-full"><Image src="/hero/renvia-villa-premium.png" alt="Photorealistic Renvia result with materials and landscaping" fill priority sizes="(min-width:1024px) 60vw,100vw" className="object-cover" /></div>} beforeLabel="Architectural model" afterLabel="Renvia render" initialPosition={40} className="!aspect-[1.18/1] !rounded-xl !border-[#deddd8] shadow-[0_32px_80px_-32px_rgba(25,25,22,.36)] sm:!aspect-[1.5/1]" />
            <span className="absolute bottom-5 right-5 rotate-[-4deg] rounded-md bg-white/85 px-3 py-2 font-display text-xs font-semibold italic text-primary shadow-sm backdrop-blur-sm">Same structure.<br/>Infinite possibilities.</span>
          </div>
        </div>
        <div className="mt-16 border-y border-hairline py-6 sm:mt-20"><p className="text-center text-[9px] font-semibold uppercase tracking-[0.2em] text-faint">Trusted by creators around the world</p><div className="mt-5 grid grid-cols-3 items-center gap-5 text-center font-display text-sm font-semibold text-[#92928f] sm:grid-cols-6 sm:text-base">{['AUTODESK','SketchUp','Figma','decor','SAMSUNG','Poliform'].map((brand) => <span key={brand}>{brand}</span>)}</div></div>
      </div>
    </section>
  );
}
