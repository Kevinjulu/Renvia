import { ArchitecturalVisual } from "@/components/visuals/ArchitecturalVisual";
import { CompareSlider } from "@/components/compare-slider/CompareSlider";
import { Logo } from "@/components/brand/Logo";
import { Reveal } from "@/components/motion/Reveal";

function VisualCard({ children, aspectClassName = "aspect-[4/3] sm:aspect-video" }: { children: React.ReactNode; aspectClassName?: string }) {
  return (
    <div className={`w-full overflow-hidden rounded-2xl border border-hairline bg-white shadow-[0_20px_60px_-30px_rgba(20,20,20,0.25)] ${aspectClassName}`}>
      {children}
    </div>
  );
}

function DotGrid({ id }: { id: string }) {
  return (
    <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
      <defs>
        <pattern id={id} width="16" height="16" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.9" fill="#E7E4DD" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

function LockBadge() {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
      className="absolute -right-1 -top-1 rounded-full bg-blueprint p-0.5 text-white"
    >
      <rect x="2" y="4.5" width="6" height="4.5" rx="0.8" fill="currentColor" />
      <path d="M3.2 4.5V3a1.8 1.8 0 0 1 3.6 0v1.5" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function UploadVisual() {
  return (
    <div className="relative flex h-full w-full items-center justify-center bg-white p-5 sm:p-8">
      <DotGrid id="how-it-works-upload-dots" />
      <div className="relative flex h-full w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-hairline-strong bg-white/90 text-center backdrop-blur-[1px]">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-surface-muted">
          <svg width="22" height="22" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="text-faint">
            <rect x="2.5" y="3.5" width="15" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
            <circle cx="7" cy="8" r="1.3" stroke="currentColor" strokeWidth="1.1" />
            <path d="M3 14.5 7.5 10l3 3 2.5-2.5L17 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-medium text-primary">Drop your model, sketch, or photo</p>
          <p className="mt-1 text-xs text-muted">or click to browse from your device</p>
        </div>
        <div className="flex gap-1.5">
          {["PNG", "JPEG", "WEBP"].map((format) => (
            <span key={format} className="rounded-full bg-surface-muted px-2.5 py-1 font-mono text-[10px] font-medium text-secondary">
              {format}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function GenerateVisual() {
  return (
    <div className="flex h-full w-full bg-white">
      <div className="flex w-[44%] shrink-0 flex-col gap-4 border-r border-hairline p-3 sm:w-[38%] sm:p-4">
        <div className="flex items-center gap-1.5">
          <Logo wordmarkClassName="text-[10px]" />
          <span className="text-xs font-medium text-primary">Project</span>
          <svg width="8" height="8" viewBox="0 0 10 10" fill="none" aria-hidden="true" className="text-faint">
            <path d="M2 3.5 5 6.5l3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        <div>
          <p className="font-mono text-[9px] uppercase tracking-wide text-faint">Style</p>
          <div className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-hairline px-2 py-1.5">
            <span className="h-5 w-6 shrink-0 rounded-md" style={{ background: "linear-gradient(135deg, #2F6FED, #C98A4A)" }} />
            <span className="flex-1 truncate text-[11px] text-primary">Photorealistic</span>
          </div>
        </div>

        <div>
          <p className="font-mono text-[9px] uppercase tracking-wide text-faint">Lighting</p>
          <div className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-hairline px-2 py-1.5">
            <span className="h-5 w-6 shrink-0 rounded-md" style={{ background: "linear-gradient(135deg, #E8A857, #2A2A28)" }} />
            <span className="flex-1 truncate text-[11px] text-primary">Warm evening</span>
          </div>
        </div>

        <div>
          <p className="font-mono text-[9px] uppercase tracking-wide text-faint">Resolution</p>
          <div className="mt-1.5 flex gap-1">
            {["1K", "2K", "4K"].map((tier) => (
              <span
                key={tier}
                className={`relative flex-1 rounded-md border px-1.5 py-1.5 text-center text-[10px] font-medium ${
                  tier === "1K" ? "border-blueprint text-blueprint" : "border-hairline text-faint"
                }`}
              >
                {tier}
                {tier !== "1K" && <LockBadge />}
              </span>
            ))}
          </div>
        </div>

        <button
          type="button"
          tabIndex={-1}
          className="mt-auto flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[11px] font-medium text-white"
        >
          <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M7 1.5 8.4 5.6 12.5 7 8.4 8.4 7 12.5 5.6 8.4 1.5 7l4.1-1.4Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          Generate 4 variations
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden bg-surface-muted">
        <DotGrid id="how-it-works-generate-dots" />
        <div
          className="absolute left-[16%] top-[18%] h-[46%] w-[52%] overflow-hidden rounded-lg border border-hairline-strong bg-white shadow-[0_12px_30px_-18px_rgba(20,20,20,0.35)]"
          style={{ transform: "rotate(-1.5deg)" }}
        >
          <ArchitecturalVisual treatment="geometry" alt="Locked structure geometry on the canvas" className="h-full w-full" />
        </div>
        <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 font-mono text-[10px] text-secondary shadow-sm">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blueprint" />
          Generating…
        </span>
      </div>
    </div>
  );
}

function CompareVisual() {
  return (
    <CompareSlider
      before={<ArchitecturalVisual treatment="geometry" alt="Original CAD geometry, uploaded model" className="h-full w-full" />}
      after={<ArchitecturalVisual treatment="render" alt="Photoreal render, same locked geometry" className="h-full w-full" />}
      beforeLabel="Original geometry"
      afterLabel="Renvia Rendered"
      cornerLabel="Drag to compare"
      initialPosition={50}
      className="shadow-[0_20px_60px_-30px_rgba(20,20,20,0.25)]"
    />
  );
}

function ExportVisual() {
  return (
    <div className="flex h-full w-full flex-col bg-white">
      <div className="flex items-center justify-between border-b border-hairline px-3 py-2.5">
        <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">Export</span>
        <div className="flex gap-1">
          {["PNG", "JPG"].map((format, i) => (
            <span
              key={format}
              className={`rounded-md px-2 py-1 font-mono text-[10px] font-medium ${
                i === 0 ? "bg-primary text-white" : "text-faint"
              }`}
            >
              {format}
            </span>
          ))}
        </div>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <ArchitecturalVisual treatment="render" alt="Final photoreal render, ready to export" className="h-full w-full" />
        <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-md bg-white/95 px-2.5 py-1.5 text-[11px] font-medium text-primary shadow-sm backdrop-blur-sm">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true" className="text-blueprint">
            <path d="M1.5 5 4 7.5 8.5 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          4K &middot; Ready
        </span>
      </div>
      <div className="flex items-center justify-between border-t border-hairline px-3 py-2.5">
        <div className="flex gap-1.5">
          {["1K", "2K", "4K"].map((tier) => (
            <span
              key={tier}
              className={`rounded-md border px-1.5 py-1 font-mono text-[10px] font-medium ${
                tier === "4K" ? "border-blueprint text-blueprint" : "border-hairline text-faint"
              }`}
            >
              {tier}
            </span>
          ))}
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-medium text-white">
          Download
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M5 1.5v5.5M2.5 5l2.5 2.5L7.5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
    </div>
  );
}

interface Step {
  number: string;
  title: string;
  description: string;
  tag: string;
  visual: React.ReactNode;
  /** Skip the VisualCard chrome for visuals (like CompareSlider) that already size and frame themselves. */
  raw?: boolean;
  aspectClassName?: string;
}

const STEPS: Step[] = [
  {
    number: "01",
    title: "Upload",
    description:
      "Drop in your 3D model export, sketch, or site photo. Renvia locks the geometry the moment it lands — walls, windows, and proportions stay exactly as drawn.",
    tag: "Geometry locked automatically",
    visual: <UploadVisual />,
  },
  {
    number: "02",
    title: "Set the look",
    description:
      "Pick a style and lighting, choose a resolution, and generate up to four variations at once — all on the same locked structure.",
    tag: "Photoreal materials & lighting",
    visual: <GenerateVisual />,
    aspectClassName: "aspect-[3/4] sm:aspect-video",
  },
  {
    number: "03",
    title: "Compare",
    description:
      "Every variation lands on the infinite canvas. Drag to compare them side by side and see exactly what changed — and what didn't.",
    tag: "Drag to compare, pixel by pixel",
    visual: <CompareVisual />,
    raw: true,
  },
  {
    number: "04",
    title: "Export",
    description:
      "Export high-resolution renders in the format you need, ready to drop straight into a client presentation.",
    tag: "Up to 4K, presentation-ready",
    visual: <ExportVisual />,
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="px-6 py-24 sm:py-32">
      <div className="mx-auto max-w-content">
        <p className="text-xs font-medium uppercase tracking-wide text-secondary">How it works</p>
        <h2 className="mt-3 max-w-xl font-display text-3xl font-semibold tracking-tight text-primary sm:text-5xl">
          From model to visualization.
        </h2>
        <p className="mt-4 max-w-md text-base leading-relaxed text-muted sm:text-lg">
          Four steps, one continuous canvas — from the file you upload to the render you present.
        </p>

        <div className="mt-16 flex flex-col gap-20 sm:mt-20 sm:gap-28 lg:gap-32">
          {STEPS.map((step, index) => {
            const imageFirst = index % 2 === 1;
            return (
              <Reveal key={step.number} className="grid gap-8 lg:grid-cols-2 lg:items-center lg:gap-16">
                <div className={imageFirst ? "lg:order-2" : ""}>
                  <p className="font-mono text-xs text-faint">{step.number}</p>
                  <h3 className="mt-3 font-display text-2xl font-semibold text-primary sm:text-3xl">{step.title}</h3>
                  <p className="mt-3 max-w-md text-sm leading-relaxed text-muted sm:text-base">{step.description}</p>
                  <span className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface-muted px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-secondary">
                    {step.tag}
                  </span>
                </div>
                <div className={imageFirst ? "lg:order-1" : ""}>
                  {step.raw ? (
                    step.visual
                  ) : (
                    <VisualCard aspectClassName={step.aspectClassName}>{step.visual}</VisualCard>
                  )}
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
