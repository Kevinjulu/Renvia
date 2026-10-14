import type { AdminOverviewResponse } from "@renvia/types";
import type { Env } from "../index.js";

type FalAccount = AdminOverviewResponse["falAccount"];

const FAL_PLATFORM_API = "https://api.fal.ai/v1";
/** The admin overview polls every 30s; one fal lookup a minute keeps us clear of its rate limit. */
const CACHE_MS = 60_000;
const SPEND_WINDOW_DAYS = 30;

let cached: { at: number; key: string; value: FalAccount } | null = null;

async function falGet<T>(key: string, path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${FAL_PLATFORM_API}${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  const response = await fetch(url, { headers: { Authorization: `Key ${key}` }, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `fal ${path} returned ${response.status}`);
  }
  return response.json() as Promise<T>;
}

/**
 * The real fal wallet, read from fal's Platform API rather than our own cost estimates, so admins
 * can see when the two drift (price changes, or calls made outside the app such as benchmarks).
 * Needs FAL_ADMIN_KEY — a key on fal's BILLING preset; the render key is not used for this.
 */
export async function falAccount(env: Env): Promise<FalAccount> {
  const key = env.FAL_ADMIN_KEY?.trim();
  if (!key) return { status: "unconfigured" };
  if (cached && cached.key === key && Date.now() - cached.at < CACHE_MS) return cached.value;

  let value: FalAccount;
  try {
    const start = new Date(Date.now() - SPEND_WINDOW_DAYS * 86_400_000).toISOString();
    const [billing, usage] = await Promise.all([
      falGet<{ credits?: { current_balance: number; currency: string } }>(key, "/account/billing", { expand: "credits" }),
      falGet<{ summary?: { cost_total: number }[] }>(key, "/models/usage", { expand: "summary", start }),
    ]);
    value = {
      status: "ok",
      balanceUsd: billing.credits?.current_balance ?? null,
      currency: billing.credits?.currency ?? "USD",
      spentLast30DaysUsd: (usage.summary ?? []).reduce((sum, row) => sum + row.cost_total, 0),
      measuredAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error("fal account lookup failed", error);
    value = { status: "error", message: error instanceof Error ? error.message : "fal account lookup failed" };
  }
  cached = { at: Date.now(), key, value };
  return value;
}
