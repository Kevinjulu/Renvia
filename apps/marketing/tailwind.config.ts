import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#FFFFFF",
        surface: "#FAFAFA",
        "surface-2": "#F1EFEA",
        "surface-muted": "#F5F5F3",
        hairline: "#E7E4DD",
        "hairline-strong": "#D8D8D4",
        primary: "#141414",
        secondary: "#666666",
        muted: "#68655F",
        faint: "#8A8A8A",
        blueprint: "#2F6FED",
        "blueprint-soft": "#EAF0FE",
        glow: "#E8A857",
        "glow-soft": "#FBEBD2",
        "render-warm": "#C98A4A",
      },
      fontFamily: {
        display: ["var(--font-general-sans)", "system-ui", "sans-serif"],
        sans: ["var(--font-switzer)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      maxWidth: {
        content: "1400px",
      },
    },
  },
  plugins: [],
};

export default config;
