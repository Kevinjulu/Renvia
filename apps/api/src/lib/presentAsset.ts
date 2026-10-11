import type { Context } from "hono";
import { createDb } from "@renvia/db";
import type { AppContext } from "../index.js";
import { presentUploadUrl } from "./storage.js";
import { requestAssetViewer } from "./watermark.js";

/**
 * Signs one of our URLs for the signed-in Studio user: model output comes back watermarked
 * on a free plan and clean on a paid one. Every Studio-facing response issues links this way.
 */
export function presentForViewer(c: Context<AppContext>, origin: string, url: string): Promise<string>;
export function presentForViewer(c: Context<AppContext>, origin: string, url: null): Promise<null>;
export function presentForViewer(c: Context<AppContext>, origin: string, url: string | null): Promise<string | null>;
export async function presentForViewer(c: Context<AppContext>, origin: string, url: string | null): Promise<string | null> {
  if (!url) return null;
  const viewer = await requestAssetViewer(c.req.raw, createDb(c.env.DATABASE_URL), c.get("auth").clerkId);
  return presentUploadUrl(c.env, origin, url, viewer);
}
