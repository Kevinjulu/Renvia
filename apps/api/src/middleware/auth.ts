import { verifyToken } from "@clerk/backend";
import { createMiddleware } from "hono/factory";
import type { AppContext } from "../index.js";
import { allowedOrigins } from "../lib/origins.js";

/**
 * Verifies the Clerk session token. Deliberately makes no Clerk Backend API call — the
 * studio polls every few seconds, and a per-request user lookup would hit Clerk's rate
 * limits and surface as random 401s. User details are synced in lib/users.ts instead.
 */
export const requireAuth = createMiddleware<AppContext>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;

  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const payload = await verifyToken(token, {
      secretKey: c.env.CLERK_SECRET_KEY,
      // Rejects tokens minted for other origins (the `azp` claim).
      authorizedParties: allowedOrigins(c.env),
    });
    c.set("auth", { clerkId: payload.sub });
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
});
