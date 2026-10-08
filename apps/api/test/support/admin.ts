import root from "../../src/index.js";
import { testEnv } from "./db.js";

export const adminEnv = testEnv({
  CLERK_SECRET_KEY: "test-clerk-secret",
  CLERK_PUBLISHABLE_KEY: "test-clerk-publishable",
  ALLOWED_ORIGINS: "http://localhost:5174",
  STORAGE_URL_SIGNING_SECRET: "test-signing-secret-test-signing-secret",
});

export const ROLES = ["user", "analyst", "support", "billing", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const MISSING_ID = "00000000-0000-4000-8000-000000000000";
export const DAY = 24 * 60 * 60 * 1000;
export const ago = (ms: number) => new Date(Date.now() - ms);

/** Calls the real app at /api/admin<path>, signed in as the user with this Clerk id. */
export function callAdmin(clerkId: string | null, method: string, path: string, body?: unknown) {
  return root.request(
    `http://localhost/api/admin${path}`,
    {
      method,
      headers: {
        ...(clerkId ? { Authorization: `Bearer ${clerkId}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    adminEnv,
  );
}

export { root };
