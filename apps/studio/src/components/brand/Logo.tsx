import { brand, brandColors, logoArt, type LogoVariant } from "@renvia/brand";

interface LogoProps {
  /** "wordmark" (default): RAMAH STUDIO over "international". "official": the RS symbol above it. "symbol": the RS symbol alone. */
  variant?: LogoVariant;
  className?: string;
  /** Font size and text colour: the logo is sized in em, and its charcoal parts take the text colour. */
  wordmarkClassName?: string;
}

// Heights in em of the surrounding font size; the wordmark's capitals come out at about 0.73em.
const HEIGHT: Record<LogoVariant, string> = { wordmark: "1.6em", official: "4.6em", symbol: "1.2em" };

export function Logo({ variant = "wordmark", className = "", wordmarkClassName = "" }: LogoProps) {
  const art = logoArt[variant];
  return (
    <span className={`inline-flex items-center ${className}`}>
      <span className={`inline-flex text-primary ${wordmarkClassName || "text-lg"}`}>
        <svg viewBox={art.viewBox} role="img" aria-label={brand.name} className="block shrink-0" style={{ height: HEIGHT[variant], width: "auto" }}>
          {art.layers.map((layer) => (
            <path key={layer.tone} d={layer.d} fill={layer.tone === "gold" ? brandColors.gold : "currentColor"} fillRule="evenodd" />
          ))}
        </svg>
      </span>
    </span>
  );
}
