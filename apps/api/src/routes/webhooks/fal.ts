import { Hono } from "hono";
import type { Env } from "../../index";

export const falWebhook = new Hono<{ Bindings: Env }>();

falWebhook.post("/", async (c) => {
  const payload = await c.req.json<unknown>();

  // TODO: verify the fal webhook signature and update the render row via @renvia/db
  console.log("fal webhook received", payload);
  return c.json({ received: true });
});
