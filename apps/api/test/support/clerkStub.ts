import { vi } from "vitest";

// Kept free of app imports: the mock factory runs while `@clerk/backend` is being imported.
/**
 * Stand-in for `@clerk/backend` in admin tests: the bearer token is treated as the Clerk user id,
 * so `Authorization: Bearer admin` signs in as the seeded user whose clerkId is "admin".
 * Use as: `vi.mock("@clerk/backend", async () => (await import("./support/clerkStub.js")).clerkStub())`.
 */
export function clerkStub() {
  return {
    verifyToken: vi.fn(async (token: string) => ({ sub: token })),
    createClerkClient: vi.fn(() => ({
      users: {
        getUser: vi.fn(async () => {
          throw new Error("Clerk is not available in tests");
        }),
      },
      sessions: {
        getSessionList: vi.fn(async () => ({ data: [{ id: "sess_1" }, { id: "sess_2" }] })),
        revokeSession: vi.fn(async () => ({})),
      },
    })),
  };
}
