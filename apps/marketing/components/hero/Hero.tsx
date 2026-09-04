import Image from "next/image";
import { CompareSlider } from "@/components/compare-slider/CompareSlider";
import { SIGNUP_URL } from "@/lib/config";

function OriginalGeometryImage() {
  return (
    <div className="relative h-full w-full">
      <Image
        src="/hero/lakeside-house-sketch.png"
        alt="Original CAD geometry, uploaded model"
        fill
        sizes="100vw"
        className="object-cover"
        priority
      />
    </div>
  );
}

function RenderedImage() {
  return (
    <div className="relative h-full w-full">
      <Image
        src="/hero/lakeside-house.jpg"
        alt="Photoreal visualization of the same house, unchanged geometry"
        fill
        sizes="100vw"
        className="object-cover"
        priority
      />
    </div>
  );
}

export function Hero() {
  return (
    <section className="px-6 pb-20 pt-32 sm:pb-28 sm:pt-40 lg:pb-32 lg:pt-44">
      <div className="mx-auto max-w-content">
        <div
          className="animate-rise-in max-w-3xl text-left"
          style={{ animationDelay: "0ms", animationDuration: "220ms" }}
        >
          <h1 className="font-display text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
            <span className="text-primary">Change the finish,</span>
            <br />
            <span className="text-primary/35">not the floor plan.</span>
          </h1>

          <p className="mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg lg:text-xl">
            Renvia isn&apos;t an AI image generator. Upload your model or
            sketch and Renvia renders photoreal materials, lighting, and
            context on your exact geometry — the walls, windows, and
            proportions stay exactly as you drew them.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <a
              href={SIGNUP_URL}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-7 py-3.5 text-base font-medium text-white transition-opacity hover:opacity-90"
            >
              Start rendering
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
            <a
              href="#how-it-works"
              className="inline-flex items-center gap-2 rounded-lg border border-hairline px-7 py-3.5 text-base font-medium text-primary transition-colors hover:border-primary/30"
            >
              See how it works
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M6 2.5v7M2.5 6.5 6 9.5l3.5-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </div>

          <div className="mt-8 flex items-center gap-2 text-xs text-faint">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="shrink-0">
              <rect x="3" y="6.5" width="8" height="6" rx="1" stroke="currentColor" strokeWidth="1.1" />
              <path d="M4.5 6.5V4.5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.1" />
            </svg>
            Secure. Private. Built for architects and designers.
          </div>
        </div>

        <CompareSlider
          before={<OriginalGeometryImage />}
          after={<RenderedImage />}
          beforeLabel="Original geometry"
          afterLabel="Renvia Rendered"
          cornerLabel="Drag to compare"
          initialPosition={45}
          className="animate-rise-in mt-14 w-full shadow-[0_20px_60px_-30px_rgba(20,20,20,0.25)] sm:mt-16 lg:mt-20"
        />
      </div>
    </section>
  );
}
