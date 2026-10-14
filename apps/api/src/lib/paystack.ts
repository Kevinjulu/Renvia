import type { Env } from "../index.js";

const BASE = "https://api.paystack.co";

export function paystackReady(env: Env) {
  return Boolean(env.PAYSTACK_SECRET_KEY?.trim());
}

/** KES per USD for Paystack charges, or null when unset or not a sensible number. */
export function kesPerUsd(env: Env): number | null {
  const rate = Number(env.PAYSTACK_KES_PER_USD);
  return Number.isFinite(rate) && rate > 1 && rate < 10_000 ? rate : null;
}

export type PaystackChannel = "card" | "mpesa";

/**
 * What Paystack charges for a USD price on a channel. M-Pesa is always shillings, in whole
 * shillings; cards are shillings too unless the account takes USD. Amounts are in the
 * currency's subunit (cents), which is also what Paystack expects.
 */
export function paystackCharge(env: Env, channel: PaystackChannel, usdCents: number): { currency: "KES" | "USD"; amountCents: number } | null {
  if (channel === "card" && env.PAYSTACK_CARD_CURRENCY === "USD") return { currency: "USD", amountCents: usdCents };
  const rate = kesPerUsd(env);
  if (!rate) return null;
  return { currency: "KES", amountCents: Math.round((usdCents / 100) * rate) * 100 };
}

export async function paystackRequest<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  if (!paystackReady(env)) throw new Error("Paystack is not configured");
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY!.trim()}`, "Content-Type": "application/json", ...init.headers },
  });
  const body = (await response.json().catch(() => null)) as { status?: boolean; message?: string; data?: T } | null;
  if (!response.ok || !body?.status || body.data === undefined) throw new Error(`Paystack request failed (${response.status})${body?.message ? `: ${body.message}` : ""}`);
  return body.data;
}

/** Paystack signs each webhook body with HMAC-SHA512 under the secret key. */
export async function verifyPaystackSignature(env: Env, rawBody: string, signature: string | undefined): Promise<boolean> {
  if (!signature || !paystackReady(env)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.PAYSTACK_SECRET_KEY!.trim()), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const expected = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (expected.length !== signature.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  return difference === 0;
}

/** The parts of a Paystack transaction Renvia reads (from verify, or a charge.success event). */
export interface PaystackTransaction {
  id: number;
  status: string;
  reference: string;
  amount: number;
  currency: string;
  paid_at?: string | null;
  customer?: { customer_code?: string; email?: string } | null;
  plan?: { plan_code?: string } | string | null;
  plan_object?: { plan_code?: string } | null;
  authorization?: { channel?: string } | null;
}

export function transactionPlanCode(transaction: PaystackTransaction): string | null {
  if (transaction.plan && typeof transaction.plan === "object" && transaction.plan.plan_code) return transaction.plan.plan_code;
  if (typeof transaction.plan === "string" && transaction.plan.startsWith("PLN_")) return transaction.plan;
  return transaction.plan_object?.plan_code ?? null;
}
