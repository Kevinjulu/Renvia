import type { Env } from "../index.js";

/** Studio origins allowed to call the API — used for CORS and to check session tokens' `azp`. */
export function allowedOrigins(env: Env): string[] {
  return env.ALLOWED_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? [];
}
