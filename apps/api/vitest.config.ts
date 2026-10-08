import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    // Run against workspace sources so tests don't depend on a prior `pnpm build`.
    alias: {
      "@renvia/db": fromRoot("../../packages/db/src/index.ts"),
      "@renvia/types": fromRoot("../../packages/types/src/index.ts"),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/globalSetup.ts"],
    setupFiles: ["test/setup.ts"],
    // Every file shares one database and truncates it between tests.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
