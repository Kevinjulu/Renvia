import { Hono } from "hono";
import { cors } from "hono/cors";
import { ZodError } from "zod";
import { renders } from "./routes/renders.js";
import { segmentations } from "./routes/segmentations.js";
import { uploads } from "./routes/uploads.js";
import { falWebhook } from "./routes/webhooks/fal.js";
import { paypalWebhook } from "./routes/webhooks/paypal.js";
import { me } from "./routes/me.js";
import { projects } from "./routes/projects.js";
import { canvasNodes } from "./routes/canvasNodes.js";
import { references } from "./routes/references.js";
import { admin } from "./routes/admin.js";
import { cron } from "./routes/cron.js";
import { billing } from "./routes/billing.js";
import { allowedOrigins } from "./lib/origins.js";
import { clientErrors } from "./routes/clientErrors.js";

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
  /** HMAC key used for expiring browser-accessible object URLs. */
  STORAGE_URL_SIGNING_SECRET: string;
  ALLOWED_ORIGINS: string;
  /** Bearer token the sweep-renders cron must present; unset disables the endpoint. */
  CRON_SECRET?: string;
  /** PayPal REST credentials — server-only, never exposed to the browser. */
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_WEBHOOK_ID?: string;
  /** Defaults to live. Set `sandbox` only for the PayPal sandbox application. */
  PAYPAL_ENV?: "sandbox" | "live";
  /** Optional server-only HTTPS endpoint for operational incident notifications. */
  OPS_NOTIFICATION_WEBHOOK_URL?: string;
}

export interface AuthVariables {
  auth: {
    clerkId: string;
  };
  /** Correlates a browser-visible response with the structured server log. */
  requestId: string;
}

export type AppContext = {
  Bindings: Env;
  Variables: AuthVariables;
};

const app = new Hono<AppContext>();

const REQUEST_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{7,127}$/;

function requestId(c: { req: { header: (name: string) => string | undefined } }) {
  const supplied = c.req.header("X-Request-Id");
  return supplied && REQUEST_ID.test(supplied) ? supplied : crypto.randomUUID();
}

app.use("*", async (c, next) => {
  const id = requestId(c);
  c.set("requestId", id);
  c.header("X-Request-Id", id);
  return cors({
    origin: allowedOrigins(c.env),
    allowHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["X-Request-Id"],
    credentials: true,
  })(c, next);
});

app.onError((err, c) => {
  if (err instanceof ZodError) {
    return c.json({ error: "Invalid request", code: "invalid_request", requestId: c.get("requestId"), issues: err.issues }, 400);
  }
  console.error(JSON.stringify({
    level: "error",
    event: "api.unhandled_error",
    requestId: c.get("requestId"),
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    error: { name: err instanceof Error ? err.name : "UnknownError", message: err instanceof Error ? err.message : String(err) },
  }));
  return c.json({ error: "Something went wrong. Please try again.", code: "internal_error", requestId: c.get("requestId") }, 500);
});

app.notFound((c) => c.json({ error: "Not found", code: "not_found", requestId: c.get("requestId") }, 404));

app.get("/health", (c) => c.json({ status: "ok" }));

app.route("/renders", renders);
app.route("/segmentations", segmentations);
app.route("/uploads", uploads);
app.route("/webhooks/fal", falWebhook);
app.route("/webhooks/paypal", paypalWebhook);
app.route("/me", me);
app.route("/projects", projects);
app.route("/canvas-nodes", canvasNodes);
app.route("/references", references);
app.route("/billing", billing);
app.route("/admin", admin);
app.route("/cron", cron);
app.route("/errors", clientErrors);

// Mounted under /api so Vercel's api/ directory convention can serve this
// whole app from a single catch-all function (see apps/api/api/[...route].ts).
const root = new Hono<AppContext>();
root.route("/api", app);

export default root;
