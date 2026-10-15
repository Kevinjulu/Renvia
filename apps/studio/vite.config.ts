import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Only VITE_-prefixed vars reach the browser. Never widen this: Clerk's React SDK reads
  // import.meta.env dynamically, which makes Vite inline every var matching the prefix —
  // a "CLERK_" prefix shipped CLERK_SECRET_KEY in the public bundle.
  envPrefix: ["VITE_"],
  // The deployed commit, attached to beta feedback so a report names the build it came from.
  // One explicit value, not an env prefix, so nothing else is inlined with it.
  define: {
    __APP_VERSION__: JSON.stringify((process.env.VERCEL_GIT_COMMIT_SHA ?? "dev").slice(0, 7)),
  },
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/[\\/]node_modules[\\/].*[\\/](konva|react-konva|react-reconciler|its-fine)[\\/]/.test(id)) return "konva";
          if (/[\\/]node_modules[\\/].*[\\/]@clerk[\\/]/.test(id)) return "clerk";
          return undefined;
        },
      },
    },
  },
});
