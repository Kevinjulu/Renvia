import type { Config } from "tailwindcss";

// Same palette as the studio so the two apps read as one product.
const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#FFFFFF",
        surface: "#FAFAFA",
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
      },
    },
  },
  plugins: [],
};

export default config;
