interface LogoProps {
  className?: string;
  wordmarkClassName?: string;
  showWordmark?: boolean;
}

/** A bar-stack "E", drawn to match the weight and width of the surrounding letters. */
function StylizedE() {
  return (
    <svg viewBox="0 0 9 12" className="inline-block h-[0.78em] w-[0.62em] align-[-0.05em]" aria-hidden="true">
      <path d="M0.5 1H8.5M0.5 6H8.5M0.5 11H8.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** An open "A" whose crossbar is cut free of the legs — a floating datum line rather than a typeset bar, echoing the E's stroke construction. */
function StylizedA() {
  return (
    <svg viewBox="0 0 12 12" className="inline-block h-[0.78em] w-[0.78em] align-[-0.05em]" aria-hidden="true">
      <path
        d="M6 1L1 11M6 1L11 11M4.2 7H7.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export function Logo({
  className = "",
  wordmarkClassName = "",
  showWordmark = true,
}: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      {showWordmark && (
        <span className={`inline-flex items-baseline font-display font-medium uppercase tracking-[0.25em] text-primary ${wordmarkClassName || "text-xl"}`}>
          <span className="sr-only">Renvia</span>
          <span aria-hidden="true" className="inline-flex items-baseline">
            R<StylizedE />NVI<StylizedA />
          </span>
        </span>
      )}
    </span>
  );
}
