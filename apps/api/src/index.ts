import { Hono } from "hono";
import { cors } from "hono/cors";
import { ZodError } from "zod";
import { renders } from "./routes/renders.js";
import { uploads } from "./routes/uploads.js";
import { falWebhook } from "./routes/webhooks/fal.js";
import { me } from "./routes/me.js";
import { projects } from "./routes/projects.js";
import { canvasNodes } from "./routes/canvasNodes.js";
import { references } from "./routes/references.js";
import { admin } from "./routes/admin.js";
import { allowedOrigins } from "./lib/origins.js";

export interface Env {
  DATABASE_URL: string;
  CLERK_SECRET_KEY: string;
  CLERK_PUBLISHABLE_KEY: string;
  FAL_KEY: string;
  /** "mock" (default, free) | "dev" (cheapest model) | "prod". */
  FAL_MODE?: string;
  /** Hard cap on total estimated fal spend, in USD. Unset means no paid renders. */
  FAL_BUDGET_USD?: string;
  NEON_STORAGE_ACCESS_KEY_ID: string;
  NEON_STORAGE_SECRET_ACCESS_KEY: string;
  NEON_STORAGE_ENDPOINT: string;
  NEON_STORAGE_BUCKET: string;
  NEON_STORAGE_REGION: string;
  ALLOWED_ORIGINS: string;
}

export interface AuthVariables {
  auth: {
    clerkId: string;
  };
}

export type AppContext = {
  Bindings: Env;
  Variables: AuthVariables;
};

const app = new Hono<AppContext>();

app.use("*", async (c, next) => {
  return cors({
    origin: allowedOrigins(c.env),
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  })(c, next);
});

app.onError((err, c) => {
  if (err instanceof ZodError) {
    return c.json({ error: "Invalid request", issues: err.issues }, 400);
  }
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.get("/health", (c) => c.json({ status: "ok" }));

app.route("/renders", renders);
app.route("/uploads", uploads);
app.route("/webhooks/fal", falWebhook);
app.route("/me", me);
app.route("/projects", projects);
app.route("/canvas-nodes", canvasNodes);
app.route("/references", references);
app.route("/admin", admin);

// Mounted under /api so Vercel's api/ directory convention can serve this
// whole app from a single catch-all function (see apps/api/api/[...route].ts).
const root = new Hono<AppContext>();
root.route("/api", app);

export default root;
