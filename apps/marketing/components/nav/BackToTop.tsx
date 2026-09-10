"use client";

import { useEffect, useState } from "react";

export function BackToTop() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const updateVisibility = () => {
      const distanceFromBottom =
        document.documentElement.scrollHeight - window.innerHeight - window.scrollY;

      setIsVisible(window.scrollY > 600 && distanceFromBottom < 700);
    };

    updateVisibility();
    window.addEventListener("scroll", updateVisibility, { passive: true });
    window.addEventListener("resize", updateVisibility);

    return () => {
      window.removeEventListener("scroll", updateVisibility);
      window.removeEventListener("resize", updateVisibility);
    };
  }, []);

  return (
    <button
      type="button"
      aria-label="Return to top"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className={`group fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full border border-white/15 bg-[#171918]/90 px-3.5 py-2.5 text-xs font-medium tracking-[-0.01em] text-white shadow-[0_12px_40px_rgba(0,0,0,0.22)] backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 hover:bg-[#252826] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f6fed] focus-visible:ring-offset-2 sm:bottom-7 sm:right-7 sm:px-4 ${
        isVisible
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-3 opacity-0"
      }`}
    >
      <span className="hidden sm:inline">Back to top</span>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="none"
        className="h-4 w-4 transition-transform duration-300 group-hover:-translate-y-0.5"
      >
        <path
          d="M4.75 8.25 10 3l5.25 5.25M10 3v14"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
