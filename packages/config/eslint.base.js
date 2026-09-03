// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

/** Shared flat ESLint config extended by each app/package. */
export const baseConfig = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    ignores: ["dist/**", ".next/**", "out/**", ".turbo/**", ".wrangler/**"],
  },
);
