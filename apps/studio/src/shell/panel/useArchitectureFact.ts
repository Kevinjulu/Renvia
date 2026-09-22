import { useEffect, useState } from "react";
import { ARCHITECTURE_FACTS } from "./architectureFacts";

const FACT_INTERVAL_MS = 6000;

/** Rotates through architecture fun facts on a fixed interval, starting from a random one. */
export function useArchitectureFact(active: boolean): string {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * ARCHITECTURE_FACTS.length));

  useEffect(() => {
    if (!active) return;
    const rotate = setInterval(() => setIndex((current) => (current + 1) % ARCHITECTURE_FACTS.length), FACT_INTERVAL_MS);
    return () => clearInterval(rotate);
  }, [active]);

  return ARCHITECTURE_FACTS[index]!;
}
