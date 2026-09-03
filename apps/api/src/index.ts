import { Hono } from "hono";
import { cors } from "hono/cors";
import { ZodError } from "zod";
import { renders } from "./routes/renders";
import { uploads } from "./routes/uploads";
import { falWebhook } from "./routes/webhooks/fal";
import { me } from "./routes/me";
import { projects } from "./routes/projects";
import { canvasNodes } from "./routes/canvasNodes";
import { createInngestHandler } from "./jobs/generateRender";

export interface Env {
  DATABASE_URL: string;
  CLERK_SECRET_KEY: string;
  CLERK_PUBLISHABLE_KEY: string;
  FAL_KEY: string;
  REPLICATE_API_TOKEN: string;
  NEON_STORAGE_ACCESS_KEY_ID: string;
  NEON_STORAGE_SECRET_ACCESS_KEY: string;
  NEON_STORAGE_ENDPOINT: string;
  NEON_STORAGE_BUCKET: string;
  NEON_STORAGE_REGION: string;
  INNGEST_EVENT_KEY: string;
  INNGEST_SIGNING_KEY: string;
  ALLOWED_ORIGINS: string;
}

export interface AuthVariables {
  auth: {
    clerkId: string;
    email: string;
  };
}

export type AppContext = {
  Bindings: Env;
  Variables: AuthVariables;
};

const app = new Hono<AppContext>();

app.use("*", async (c, next) => {
  const allowedOrigins = c.env.ALLOWED_ORIGINS?.split(",").map((origin) => origin.trim()) ?? [];
  return cors({
    origin: allowedOrigins,
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
app.on(["GET", "POST", "PUT"], "/inngest", (c) => createInngestHandler(c.env)(c));

// Mounted under /api so Vercel's api/ directory convention can serve this
// whole app from a single catch-all function (see apps/api/api/[...route].ts).
const root = new Hono<AppContext>();
root.route("/api", app);

export default root;
