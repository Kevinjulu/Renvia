import type { Config } from "tailwindcss";

// Premium admin design system. Shares the studio palette so the two apps read as
// one product, then layers on a dark "ink" sidebar scale, elevation, and motion.
const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#FFFFFF",
        surface: "#F7F6F3",
        "surface-muted": "#F1EFEA",
        hairline: "#E7E4DD",
        "hairline-strong": "#D8D8D4",
        primary: "#141414",
        secondary: "#5C5A55",
        muted: "#78756E",
        faint: "#9A968E",
        blueprint: "#2F6FED",
        "blueprint-soft": "#EAF0FE",
        "blueprint-strong": "#1B4FCB",
        glow: "#E8A857",
        "glow-soft": "#FBEBD2",
        // Dark sidebar / "ink" scale.
        ink: {
          950: "#0C0D10",
          900: "#111318",
          850: "#16181E",
          800: "#1C1F26",
          700: "#262A33",
          600: "#333844",
          400: "#8A8F9C",
          300: "#A6ABB8",
          200: "#C7CBD4",
        },
      },
      fontFamily: {
        display: ['"Plus Jakarta Sans"', "system-ui", "sans-serif"],
        sans: ['"Inter"', "system-ui", "-apple-system", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(20,20,20,0.04), 0 1px 3px rgba(20,20,20,0.03)",
        "card-hover": "0 10px 30px -12px rgba(20,20,20,0.18)",
        soft: "0 4px 20px rgba(19,24,34,0.06)",
        lift: "0 18px 40px -20px rgba(15,18,24,0.35)",
        glow: "0 0 0 1px rgba(47,111,237,0.35), 0 8px 24px -8px rgba(47,111,237,0.45)",
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
        "3xl": "1.5rem",
      },
      backgroundImage: {
        "ink-radial": "radial-gradient(120% 120% at 50% 0%, #1C1F26 0%, #141317 55%, #0C0D10 100%)",
        "accent-sheen": "linear-gradient(135deg, #2F6FED 0%, #4F86F5 100%)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "rise-in": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: { "100%": { transform: "translateX(100%)" } },
      },
      animation: {
        "fade-in": "fade-in 0.3s ease both",
        "rise-in": "rise-in 0.4s cubic-bezier(0.16,1,0.3,1) both",
      },
    },
  },
  plugins: [],
};

export default config;
