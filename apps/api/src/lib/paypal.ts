import type { Env } from "../index.js";

const base = (env: Env) => env.PAYPAL_ENV === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";

export function paypalReady(env: Env) {
  return Boolean(env.PAYPAL_CLIENT_ID?.trim() && env.PAYPAL_CLIENT_SECRET?.trim() && env.PAYPAL_WEBHOOK_ID?.trim());
}

async function accessToken(env: Env) {
  if (!paypalReady(env)) throw new Error("PayPal is not configured");
  const response = await fetch(`${base(env)}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) throw new Error("PayPal authentication failed");
  const body = await response.json() as { access_token?: string };
  if (!body.access_token) throw new Error("PayPal authentication response was invalid");
  return body.access_token;
}

export async function paypalRequest<T>(env: Env, path: string, init: RequestInit = {}) {
  const token = await accessToken(env);
  const response = await fetch(`${base(env)}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
  });
  const body = await response.json().catch(() => null) as T | null;
  if (!response.ok || !body) throw new Error(`PayPal request failed (${response.status})`);
  return body;
}

export function approvalUrl(payload: { links?: { rel?: string; href?: string }[] }) {
  const url = payload.links?.find((link) => link.rel === "approve" || link.rel === "payer-action")?.href;
  if (!url) throw new Error("PayPal did not return an approval URL");
  return url;
}

export type PaypalOrder = { id: string; status: string; links?: { rel?: string; href?: string }[] };
export type PaypalSubscription = { id: string; status: string; links?: { rel?: string; href?: string }[] };
