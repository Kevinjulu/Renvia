import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Only VITE_-prefixed vars reach the browser. Never widen this: Clerk's React SDK reads
  // import.meta.env dynamically, which makes Vite inline every var matching the prefix —
  // a "CLERK_" prefix shipped CLERK_SECRET_KEY in the public bundle.
  envPrefix: ["VITE_"],
  server: {
    port: 5173,
  },
});
