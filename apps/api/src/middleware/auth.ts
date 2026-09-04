import { createClerkClient, verifyToken } from "@clerk/backend";
import { createMiddleware } from "hono/factory";
import type { AppContext } from "../index.js";

export const requireAuth = createMiddleware<AppContext>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;

  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const payload = await verifyToken(token, { secretKey: c.env.CLERK_SECRET_KEY });
    const clerkClient = createClerkClient({ secretKey: c.env.CLERK_SECRET_KEY });
    const user = await clerkClient.users.getUser(payload.sub);
    const email = user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress;

    if (!email) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    c.set("auth", { clerkId: payload.sub, email });
    await next();
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }
});
