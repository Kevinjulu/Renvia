import { useEffect, useRef } from "react";

export type AuthAccent = "blueprint" | "glow";

interface PanelStat {
  label: string;
  value: string;
}

interface BlueprintPanelProps {
  image: string;
  label: string;
  title: string;
  description: string;
  accent?: AuthAccent;
  stat?: PanelStat;
}

const ACCENT_DOT: Record<AuthAccent, string> = {
  blueprint: "bg-blueprint",
  glow: "bg-glow",
};

export function BlueprintPanel({ image, label, title, description, accent = "blueprint", stat }: BlueprintPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    const handleMove = (event: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (layerRef.current) layerRef.current.style.transform = `translate(${x * -10}px, ${y * -10}px)`;
        if (gridRef.current) gridRef.current.style.transform = `translate(${x * -16}px, ${y * -16}px)`;
      });
    };
    const handleLeave = () => {
      cancelAnimationFrame(frame);
      if (layerRef.current) layerRef.current.style.transform = "";
      if (gridRef.current) gridRef.current.style.transform = "";
    };

    container.addEventListener("mousemove", handleMove);
    container.addEventListener("mouseleave", handleLeave);
    return () => {
      container.removeEventListener("mousemove", handleMove);
      container.removeEventListener("mouseleave", handleLeave);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={containerRef} className="relative hidden overflow-hidden bg-primary lg:block lg:w-1/2">
      <div ref={layerRef} className="absolute -inset-4 transition-transform duration-300 ease-out">
        <img
          src={image}
          alt=""
          aria-hidden="true"
          className="animate-slow-zoom h-full w-full object-cover"
        />
      </div>

      <div className="absolute inset-0 bg-gradient-to-t from-primary/90 via-primary/25 to-primary/20" />
      <div className="absolute inset-0 bg-gradient-to-b from-primary/35 via-transparent to-transparent" />

      <svg
        ref={gridRef}
        className="absolute inset-0 h-full w-full opacity-20 transition-transform duration-300 ease-out"
        aria-hidden="true"
      >
        <defs>
          <pattern id="auth-blueprint-grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M 48 0 L 0 0 0 48" fill="none" stroke="white" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#auth-blueprint-grid)" />
      </svg>

      <CornerBracket className="left-8 top-8" delay="0ms" />
      <CornerBracket className="right-8 top-8 rotate-90" delay="80ms" />
      <CornerBracket className="bottom-8 left-8 -rotate-90" delay="160ms" />
      <CornerBracket className="bottom-8 right-8 rotate-180" delay="240ms" />

      <div className="animate-rise-in absolute inset-x-8 top-8 flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${ACCENT_DOT[accent]}`} />
        <span className="font-mono text-xs uppercase tracking-wide text-white/80">{label}</span>
      </div>

      {stat && (
        <div
          className="animate-rise-in absolute right-8 top-1/2 hidden -translate-y-1/2 items-center gap-2.5 rounded-lg border border-white/15 bg-white/10 px-3.5 py-2.5 backdrop-blur-md xl:flex"
          style={{ animationDelay: "280ms" }}
        >
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${ACCENT_DOT[accent]}`} />
          <div className="flex flex-col">
            <span className="font-mono text-[10px] uppercase tracking-wide text-white/55">{stat.label}</span>
            <span className="text-xs font-medium text-white">{stat.value}</span>
          </div>
        </div>
      )}

      <div className="absolute inset-x-8 bottom-14 max-w-lg">
        <p
          className="animate-rise-in font-display text-4xl font-semibold leading-[1.05] tracking-tight text-white lg:text-5xl xl:text-6xl"
          style={{ animationDelay: "80ms" }}
        >
          {title}
        </p>
        <p
          className="animate-rise-in mt-4 max-w-md text-lg text-white/75 xl:text-xl"
          style={{ animationDelay: "160ms" }}
        >
          {description}
        </p>
      </div>
    </div>
  );
}

function CornerBracket({ className, delay }: { className: string; delay: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      className={`absolute text-white/50 ${className}`}
      aria-hidden="true"
    >
      <path
        d="M1 8V1H8"
        stroke="currentColor"
        strokeWidth="1.2"
        className="animate-draw-in"
        style={{ animationDelay: delay }}
      />
    </svg>
  );
}
