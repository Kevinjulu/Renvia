import { serve } from "inngest/hono";
import type { Env } from "../index";
import { inngest } from "../lib/inngest";

export const generateRenderJob = inngest.createFunction(
  { id: "generate-render" },
  { event: "render/requested" },
  async ({ event, step }) => {
    // TODO: no AI provider is configured yet. Once one is, this needs the request-scoped
    // Env (DATABASE_URL, FAL_KEY, R2 bindings) threaded in — Workers has no process.env,
    // so the db/fal clients can't be constructed from this step in isolation.
    await step.run("noop", async () => ({ received: event.data }));
  },
);

export function createInngestHandler(env: Env) {
  return serve({
    client: inngest,
    functions: [generateRenderJob],
    signingKey: env.INNGEST_SIGNING_KEY,
  });
}
