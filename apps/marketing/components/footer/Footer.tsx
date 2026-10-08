"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { SIGNUP_URL } from "@/lib/config";

const FOOTER_LINKS = [
  {
    heading: "Product",
    links: [
      { label: "Studio", href: SIGNUP_URL },
      { label: "Pricing", href: "/pricing" },
      { label: "What's new", href: "/blog" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "/#features" },
      { label: "Our process", href: "/#how-it-works" },
      { label: "Journal", href: "/blog" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { label: "Rendering guide", href: "/blog/architectural-rendering-workflow" },
      { label: "Prompt guide", href: "/blog/better-architectural-ai-prompts" },
      { label: "Consistency guide", href: "/blog/consistent-four-elevation-renders" },
    ],
  },
];

function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CTABanner() {
  return (
    <div className="relative h-64 overflow-hidden rounded-2xl border border-hairline sm:h-72">
      <div className="absolute inset-0 flex">
        <div className="relative h-full w-1/2">
          <Image
            src="/hero/lakeside-house-sketch.png"
            alt="Original architectural drawing, uploaded model"
            fill
            sizes="50vw"
            className="object-cover"
          />
        </div>
        <div className="relative h-full w-1/2">
          <Image
            src="/hero/lakeside-house.jpg"
            alt="Photoreal render of the same house"
            fill
            sizes="50vw"
            className="object-cover"
          />
        </div>
      </div>
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0)_0%,rgba(255,255,255,0.94)_38%,rgba(255,255,255,0.94)_62%,rgba(255,255,255,0)_100%)]" />

      <div className="relative z-10 flex h-full flex-col items-center justify-center px-6 text-center">
        <h3 className="font-display text-2xl font-semibold leading-tight text-primary sm:text-3xl">
          See what your model
          <br />
          could become.
        </h3>
        <p className="mt-3 max-w-xs text-sm text-muted">Upload your first project and start exploring.</p>
        <a
          href={SIGNUP_URL}
          className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          Start rendering
          <ArrowIcon />
        </a>
      </div>
    </div>
  );
}

export function Footer() {
  const [subscribed, setSubscribed] = useState(false);
  return (
    <footer className="border-t border-hairline px-6 py-16">
      <div className="mx-auto max-w-content">
        <CTABanner />

        <div className="mt-14 grid grid-cols-2 gap-10 sm:grid-cols-5 sm:gap-8">
          <div className="col-span-2 sm:col-span-1">
            <Link href="/" aria-label="Renvia home" className="inline-flex items-center">
              <Logo />
            </Link>
            <p className="mt-3 max-w-[26ch] text-sm text-muted">
              AI-powered visualization for architects and designers.
            </p>
          </div>

          {FOOTER_LINKS.map((group) => (
            <div key={group.heading}>
              <p className="text-xs font-medium uppercase tracking-wide text-secondary">{group.heading}</p>
              <ul className="mt-3 flex flex-col gap-2.5">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <a href={link.href} className="text-sm text-primary transition-colors hover:text-secondary">
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-secondary">Newsletter</p>
            <p className="mt-3 text-sm text-muted">Get tips, updates, and inspiration straight to your inbox.</p>
            <form
              className="mt-3 flex items-center gap-2 rounded-lg border border-hairline-strong px-3 py-2 transition-colors focus-within:border-primary/30"
              onSubmit={(event) => { event.preventDefault(); setSubscribed(true); }}
            >
              <input
                type="email"
                required
                placeholder="Your email"
                className="w-full bg-transparent text-sm text-primary placeholder:text-faint focus:outline-none"
              />
              <button type="submit" aria-label="Subscribe" className="shrink-0 text-primary transition-opacity hover:opacity-70">
                <ArrowIcon />
              </button>
            </form>
            {subscribed && <p className="mt-2 text-xs text-secondary" role="status">You’re on the list. Welcome to Renvia.</p>}
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-2 border-t border-hairline pt-6 text-xs text-muted sm:flex-row sm:justify-between">
          <span>© {new Date().getFullYear()} Renvia. All rights reserved.</span>
          <div className="flex gap-4">
            <Link href="/privacy" className="transition-colors hover:text-primary">
              Privacy
            </Link>
            <Link href="/terms" className="transition-colors hover:text-primary">
              Terms
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
