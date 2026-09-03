import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Clerk's key ships as CLERK_PUBLISHABLE_KEY in the shared .env.example
  // (not VITE_-prefixed); widen envPrefix so Vite still exposes it to the client.
  envPrefix: ["VITE_", "CLERK_"],
  server: {
    port: 5173,
  },
});
