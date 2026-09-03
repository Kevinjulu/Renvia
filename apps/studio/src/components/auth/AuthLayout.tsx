import type { ReactNode } from "react";
import { BlueprintPanel, type AuthAccent } from "./BlueprintPanel";
import { Logo } from "../brand/Logo";
import { MARKETING_URL } from "../../lib/env";

interface AuthLayoutProps {
  image: string;
  label: string;
  title: string;
  description: string;
  accent?: AuthAccent;
  stat?: { label: string; value: string };
  children: ReactNode;
}

const ACCENT_DOT = {
  blueprint: "bg-blueprint",
  glow: "bg-glow",
} as const;

export function AuthLayout({ image, label, title, description, accent = "blueprint", stat, children }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas lg:flex-row">
      <div className="relative overflow-hidden bg-primary px-6 py-5 lg:hidden">
        <img src={image} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover opacity-40" />
        <div className="absolute inset-0 bg-gradient-to-b from-primary/70 via-primary/85 to-primary" />
        <div className="relative flex items-center gap-2">
          <span className={`h-1.5 w-1.5 rounded-full ${ACCENT_DOT[accent]}`} />
          <span className="font-mono text-xs uppercase tracking-wide text-white/80">{label}</span>
        </div>
        <p className="relative mt-1.5 font-display text-lg font-semibold leading-snug text-white">{title}</p>
      </div>

      <BlueprintPanel image={image} label={label} title={title} description={description} accent={accent} stat={stat} />

      <div className="relative flex flex-1 flex-col justify-start px-6 pb-16 pt-8 sm:px-12 lg:justify-center lg:px-16 lg:pb-16 lg:pt-16">
        <a
          href={MARKETING_URL}
          aria-label="Renvia home"
          className="mb-8 inline-flex items-center self-start lg:absolute lg:left-16 lg:top-16 lg:mb-0"
        >
          <Logo />
        </a>
        <div className="mx-auto w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
