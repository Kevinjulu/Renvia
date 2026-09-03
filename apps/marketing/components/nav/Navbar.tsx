"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LOGIN_URL, SIGNUP_URL } from "@/lib/config";
import { Logo } from "@/components/brand/Logo";

const NAV_LINKS = [
  { label: "Product", href: "#features" },
  { label: "Pricing", href: "#pricing" },
  { label: "Docs", href: "#" },
  { label: "API", href: "#" },
];

function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const NAV_LINK_CLASS = "text-sm font-medium tracking-wide text-muted transition-colors hover:text-primary";

const CTA_CLASS =
  "inline-flex items-center gap-2 rounded-lg bg-primary font-medium text-white transition-all duration-150 hover:opacity-90 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2";

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      {/* backdrop-blur lives on this inner wrapper, not <header> itself — backdrop-filter on an
          ancestor of a position:fixed element changes its containing block in Chromium, which
          broke the stacking of the fixed mobile menu panel below (it rendered behind page content). */}
      <div
        className={`border-b bg-canvas/95 backdrop-blur transition-shadow duration-200 ${
          scrolled || menuOpen ? "border-hairline shadow-[0_1px_0_rgba(20,20,20,0.04)]" : "border-transparent"
        }`}
      >
        <div className="mx-auto flex max-w-content items-center justify-between px-6 py-4">
          <Link href="/" aria-label="Renvia home">
            <Logo />
          </Link>

          <nav className="hidden items-center gap-8 md:flex">
            {NAV_LINKS.map((link) => (
              <a key={link.label} href={link.href} className={NAV_LINK_CLASS}>
                {link.label}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-6 md:flex">
            <a href={LOGIN_URL} className="text-sm font-medium tracking-wide text-muted transition-colors hover:text-primary">
              Sign in
            </a>
            <a href={SIGNUP_URL} className={`${CTA_CLASS} px-4 py-2 text-sm`}>
              Start rendering
              <ArrowIcon />
            </a>
          </div>

          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            className="flex h-9 w-9 items-center justify-center text-primary md:hidden"
          >
            {menuOpen ? (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M4 4L16 16M16 4L4 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M2.5 5.5H17.5M2.5 10H17.5M2.5 14.5H17.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="fixed inset-x-0 top-[65px] bottom-0 flex flex-col justify-between bg-canvas px-6 py-10 md:hidden">
          <nav className="flex flex-col gap-6">
            {NAV_LINKS.map((link) => (
              <a
                key={link.label}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="font-display text-3xl font-medium text-primary"
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div className="flex flex-col gap-4">
            <a href={LOGIN_URL} className="text-center text-base font-medium text-muted transition-colors hover:text-primary">
              Sign in
            </a>
            <a href={SIGNUP_URL} className={`${CTA_CLASS} justify-center px-4 py-3 text-base`}>
              Start rendering
              <ArrowIcon />
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
