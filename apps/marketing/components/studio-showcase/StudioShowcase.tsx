import { ArchitecturalVisual } from "@/components/visuals/ArchitecturalVisual";
import { Logo } from "@/components/brand/Logo";
import { Reveal } from "@/components/motion/Reveal";
import { STUDIO_URL } from "@/lib/config";

const CALLOUTS = [
  { dot: { x: 50, y: 14 }, label: { x: 50, y: 3 }, text: "Canvas — infinite zoom" },
  { dot: { x: 19, y: 32 }, label: { x: 15, y: 12 }, text: "Structure locked" },
  { dot: { x: 54, y: 25 }, label: { x: 70, y: 8 }, text: "Same project, 4 angles" },
  { dot: { x: 76, y: 67 }, label: { x: 92, y: 84 }, text: "Compare" },
];

// Box size/position differs between the stacked mobile canvas (narrow width, tall min-height —
// needs squarer boxes) and the fixed-height desktop row (wide, short — needs taller boxes) so
// `object-cover` doesn't crop the square source photos too aggressively in either layout.
const ELEVATIONS = [
  {
    treatment: "elevation-front" as const,
    className: "left-[4%] top-[6%] h-[30%] w-[42%] rotate-[-2deg] lg:left-[4%] lg:top-[8%] lg:h-[44%] lg:w-[27%]",
  },
  {
    treatment: "elevation-rear" as const,
    className: "left-[48%] top-[2%] h-[32%] w-[46%] rotate-[1.5deg] lg:left-[36%] lg:top-[4%] lg:h-[46%] lg:w-[28%]",
  },
  {
    treatment: "elevation-side-a" as const,
    className: "left-[6%] top-[40%] h-[26%] w-[38%] rotate-[2deg] lg:left-[6%] lg:top-[54%] lg:h-[34%] lg:w-[24%]",
  },
  {
    treatment: "elevation-side-b" as const,
    className: "left-[54%] top-[36%] h-[30%] w-[44%] rotate-[-1.5deg] lg:left-[58%] lg:top-[44%] lg:h-[46%] lg:w-[30%]",
  },
];

function InfiniteCanvasIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="6" height="6" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="4" y="4" width="6" height="6" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function IterateIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="1" y="2.5" width="4.5" height="7" rx="0.5" stroke="currentColor" strokeWidth="1.1" />
      <rect x="6.5" y="2.5" width="4.5" height="7" rx="0.5" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M6 1.5v6M3.5 5l2.5 2.5L8.5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 9.5h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function Avatar({ color }: { color: string }) {
  return <span className="h-6 w-6 rounded-full border-2 border-white" style={{ background: color }} aria-hidden="true" />;
}

function CanvasArea() {
  return (
    <div className="relative min-h-[420px] flex-1 overflow-hidden bg-surface-muted">
      <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <pattern id="studio-dots" width="18" height="18" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.9" fill="#E7E4DD" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#studio-dots)" />
      </svg>

      {ELEVATIONS.map(({ treatment, className }) => (
        <div
          key={treatment}
          className={`absolute overflow-hidden rounded-lg border border-hairline-strong bg-white shadow-[0_12px_30px_-18px_rgba(20,20,20,0.3)] ${className}`}
        >
          <ArchitecturalVisual treatment={treatment} className="h-full w-full" />
        </div>
      ))}

      <span className="absolute right-3 top-3 hidden rounded-md bg-white px-2 py-1 font-mono text-[10px] text-secondary shadow-sm lg:block">
        Lakeside House &middot; 4 elevations
      </span>

      <svg className="absolute inset-0 hidden h-full w-full overflow-visible lg:block" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {CALLOUTS.map((c) => (
          <line key={c.text} x1={c.dot.x} y1={c.dot.y} x2={c.label.x} y2={c.label.y} stroke="#8FBFD2" strokeWidth="0.25" />
        ))}
        {CALLOUTS.map((c) => (
          <circle key={`${c.text}-dot`} cx={c.dot.x} cy={c.dot.y} r="0.7" fill="#2F6FED" />
        ))}
      </svg>
      {CALLOUTS.map((c) => (
        <span
          key={c.text}
          className="absolute hidden -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border border-hairline-strong bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-secondary shadow-sm lg:block"
          style={{ left: `${c.label.x}%`, top: `${c.label.y}%` }}
        >
          {c.text}
        </span>
      ))}

      <span className="absolute bottom-3 left-3 flex items-center gap-1 rounded-md border border-hairline-strong bg-white px-2 py-1 font-mono text-[10px] text-secondary shadow-sm">
        <button type="button" className="px-0.5" aria-label="Zoom out">−</button>
        140%
        <button type="button" className="px-0.5" aria-label="Zoom in">+</button>
      </span>
    </div>
  );
}

function PropertiesPanel() {
  const fields = [
    { label: "Style", value: "Warm Modern" },
    { label: "Lighting", value: "Warm Evening" },
    { label: "Camera", value: "Exterior Wide" },
    { label: "Format", value: "16:9" },
    { label: "Detail", value: "High" },
  ];
  return (
    <div className="flex w-full shrink-0 flex-col border-t border-hairline bg-white lg:w-[220px] lg:border-l lg:border-t-0">
      <div className="flex border-b border-hairline text-xs">
        <span className="border-b-2 border-primary px-4 py-3 font-medium text-primary">Renders</span>
        <span className="px-4 py-3 text-faint">Properties</span>
      </div>
      <div className="flex flex-col gap-3 p-4">
        {fields.map((field) => (
          <div key={field.label}>
            <p className="font-mono text-[10px] uppercase tracking-wide text-faint">{field.label}</p>
            <div className="mt-1 flex items-center justify-between rounded-md border border-hairline px-2.5 py-1.5 text-xs text-primary">
              {field.value}
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true" className="text-faint">
                <path d="M1.5 3 4 5.5 6.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        ))}
        <button
          type="button"
          className="mt-1 rounded-md bg-primary px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90"
        >
          Generate
        </button>
      </div>
      <div className="mt-auto flex gap-1.5 border-t border-hairline p-3">
        {(["render", "wood", "stone"] as const).map((treatment) => (
          <div key={treatment} className="h-8 w-8 overflow-hidden rounded-sm border border-hairline">
            <ArchitecturalVisual treatment={treatment} alt="" className="h-full w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function StudioShowcase() {
  return (
    <section className="px-6 py-24">
      <div className="mx-auto max-w-content">
        <Reveal className="max-w-xl">
          <p className="text-xs font-medium uppercase tracking-wide text-blueprint">Renvia Studio</p>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-primary sm:text-5xl">
            Your ideas.
            <br />
            Visually realized.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted sm:text-lg">
            The infinite canvas studio gives you the space to explore every
            possibility, iterate, compare, and present with clarity.
          </p>
          <a
            href={STUDIO_URL}
            className="group mt-6 inline-flex items-center gap-2 text-sm font-medium text-primary underline decoration-hairline-strong underline-offset-4 transition-colors hover:text-blueprint hover:decoration-blueprint"
          >
            Explore the studio
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              aria-hidden="true"
              className="transition-transform duration-200 group-hover:translate-x-0.5"
            >
              <path d="M3 6h6M6 3l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </Reveal>

        <Reveal delay={80}>
          <div className="mt-12 overflow-hidden rounded-2xl border border-hairline bg-white shadow-[0_30px_80px_-40px_rgba(20,20,20,0.3)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_40px_90px_-40px_rgba(20,20,20,0.4)]">
            <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
              <div className="flex items-center gap-3">
                <Logo wordmarkClassName="text-sm" />
                <span className="rounded-md border border-hairline px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-secondary">
                  Infinite canvas
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex -space-x-2">
                  <Avatar color="#2F6FED" />
                  <Avatar color="#C98A4A" />
                  <Avatar color="#8FBFD2" />
                </div>
                <button type="button" className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white">
                  Share
                </button>
              </div>
            </div>

            <div className="flex flex-col lg:h-[520px] lg:flex-row">
              <CanvasArea />
              <PropertiesPanel />
            </div>
          </div>
        </Reveal>

        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
          {[
            {
              title: "Infinite canvas",
              description: "Organize views and iterations freely.",
              icon: <InfiniteCanvasIcon />,
            },
            {
              title: "Iterate & compare",
              description: "Compare multiple variations side by side.",
              icon: <IterateIcon />,
            },
            {
              title: "Export with ease",
              description: "High-res images ready for presentations.",
              icon: <ExportIcon />,
            },
          ].map((item, index) => (
            <Reveal key={item.title} delay={160 + index * 80} className="flex items-start gap-2.5">
              <span className="mt-0.5 shrink-0 text-secondary">{item.icon}</span>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-primary">{item.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">{item.description}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
