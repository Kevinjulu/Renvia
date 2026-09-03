import Image from "next/image";
import { ArchitecturalVisual } from "@/components/visuals/ArchitecturalVisual";
import { CompareSlider } from "@/components/compare-slider/CompareSlider";
import { Reveal } from "@/components/motion/Reveal";

function LockIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 11V8a5 5 0 0 1 10 0v3" stroke="currentColor" strokeWidth="1.3" />
      <rect x="4.5" y="11" width="15" height="9.5" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="12" cy="15.5" r="1.2" fill="currentColor" />
    </svg>
  );
}

function BeforeAfterIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="5" width="9" height="14" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="11" y="5" width="9" height="14" rx="1" fill="currentColor" fillOpacity="0.08" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="12" cy="12" r="2.6" fill="white" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

function LockGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M4 6.5V4.7a3 3 0 0 1 6 0V6.5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="2.5" y="6.5" width="9" height="6" rx="1.3" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function StructureLockedVisual() {
  return (
    <div className="relative h-full w-full bg-white">
      <Image
        src="/hero/lakeside-house-sketch.png"
        alt="Original uploaded architectural drawing, geometry locked"
        fill
        sizes="(min-width: 1024px) 50vw, 100vw"
        className="object-contain p-6"
      />
      <span className="absolute bottom-4 left-4 inline-flex items-center gap-1.5 rounded-md border border-hairline-strong bg-white px-2.5 py-1.5 text-xs font-medium text-primary shadow-sm">
        <LockGlyph />
        Geometry locked
      </span>
    </div>
  );
}

function BeforeAfterVisual() {
  return (
    <CompareSlider
      before={<ArchitecturalVisual treatment="geometry" alt="Original CAD geometry, uploaded model" className="h-full w-full" />}
      after={<ArchitecturalVisual treatment="render" alt="Photoreal render, same locked geometry" className="h-full w-full" />}
      beforeLabel="Original geometry"
      afterLabel="Renvia Rendered"
      initialPosition={50}
      fill
    />
  );
}

const FEATURED = [
  {
    title: "Structure locked",
    description: "Your geometry stays exactly as drawn. Renvia changes only materials, lighting, and context.",
    icon: <LockIcon />,
    visual: <StructureLockedVisual />,
  },
  {
    title: "Before / After",
    description: "Drag to compare any two variations, side by side. Every material, every detail.",
    icon: <BeforeAfterIcon />,
    visual: <BeforeAfterVisual />,
  },
];

const CARD_HOVER =
  "transition-all duration-300 hover:-translate-y-1 hover:border-hairline-strong hover:shadow-[0_20px_40px_-24px_rgba(20,20,20,0.2)]";

export function CapabilityGrid() {
  return (
    <section id="features" className="border-t border-hairline px-6 py-20 sm:py-28">
      <div className="mx-auto max-w-content">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-secondary">
            Built for architects and designers
          </p>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-primary sm:text-4xl">
            Nothing about your design changes. Everything about how it looks does.
          </h2>
          <p className="mt-4 max-w-md mx-auto text-base leading-relaxed text-muted sm:text-lg">
            Renvia keeps every render accurate to the design you drew, so what you present matches what you built.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-4 lg:grid-cols-2 sm:mt-16">
          {FEATURED.map((item, index) => (
            <Reveal key={item.title} delay={index * 80}>
              <div className={`h-full overflow-hidden rounded-2xl border border-hairline bg-white ${CARD_HOVER}`}>
                <div className="h-52 border-b border-hairline sm:h-60">{item.visual}</div>
                <div className="p-6">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-hairline text-primary">
                    {item.icon}
                  </span>
                  <p className="mt-4 text-sm font-medium text-primary">{item.title}</p>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted">{item.description}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
