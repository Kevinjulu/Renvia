import { eq, sql } from "drizzle-orm";
import { schema, type Database } from "@renvia/db";
import type { Env } from "../index.js";

/**
 * Browser and network evidence for the Free-allowance rules, collected with as little as
 * possible: the Studio's random first-party browser id (X-Client-Id) and the request's network
 * prefix (/24 for IPv4, /48 for IPv6), each stored only as an HMAC under SECURITY_HASH_KEY, never
 * as the raw value. Collection runs only while app_settings.security_signals_enabled is on and the
 * key is set, and only on the Studio's account load (/me).
 *
 * The client IP comes only from the header the hosting platform sets (TRUSTED_IP_HEADER, default
 * x-real-ip on Vercel), never from one the browser can forge, such as the first X-Forwarded-For
 * entry. A missing browser id or IP is simply no evidence: it never counts against anyone.
 *
 * Retention: network links 30 days and browser links 180 days after they were last seen
 * (purgeSecurityLinks, from the daily cron). Changing SECURITY_HASH_KEY starts linking afresh.
 */

const CLIENT_ID = /^[A-Za-z0-9_-]{16,64}$/;
export const NETWORK_RETENTION_DAYS = 30;
export const DEVICE_RETENTION_DAYS = 180;

export interface RawSignals {
  clientId: string | null;
  networkPrefix: string | null;
}

export interface HashedSignals {
  device: string | null;
  network: string | null;
}

/** IPv4 /24 or IPv6 /48 of an address, or null if it isn't one. */
export function networkPrefix(address: string): string | null {
  const ip = address.trim().replace(/^\[|\]$/g, "");
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.replace(/^::ffff:/i, ""));
  if (v4) {
    const parts = v4.slice(1, 4).map(Number);
    return parts.every((part) => part <= 255) && Number(v4[4]) <= 255 ? `${parts.join(".")}.0/24` : null;
  }
  if (!ip.includes(":") || !/^[0-9a-f:]+$/i.test(ip)) return null;
  const [head, tail] = ip.split("::");
  if (ip.split("::").length > 2) return null;
  const left = head ? head.split(":") : [];
  const right = tail !== undefined && tail ? tail.split(":") : [];
  const groups = tail !== undefined ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  if (groups.length !== 8 || groups.some((group) => group.length === 0 || group.length > 4)) return null;
  return `${groups.slice(0, 3).map((group) => parseInt(group, 16).toString(16)).join(":")}::/48`;
}

/** The browser id and network prefix of a request, before hashing. */
export function requestSignals(env: Env, header: (name: string) => string | undefined): RawSignals {
  const clientId = header("X-Client-Id")?.trim() ?? "";
  const trusted = (env.TRUSTED_IP_HEADER?.trim() || "x-real-ip").toLowerCase();
  const address = header(trusted)?.split(",")[0]?.trim() ?? "";
  return { clientId: CLIENT_ID.test(clientId) ? clientId : null, networkPrefix: address ? networkPrefix(address) : null };
}

async function hmac(key: string, value: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value)));
  return Buffer.from(digest).toString("base64url");
}

/** Keyed hashes of the signals, or null when there's no key (nothing can be recorded then). */
export async function hashSignals(env: Env, raw: RawSignals): Promise<HashedSignals | null> {
  const key = env.SECURITY_HASH_KEY?.trim();
  if (!key || key.length < 32) return null;
  const [device, network] = await Promise.all([
    raw.clientId ? hmac(key, `device:${raw.clientId}`) : null,
    raw.networkPrefix ? hmac(key, `network:${raw.networkPrefix}`) : null,
  ]);
  return { device, network };
}

/**
 * Notes that this account was used from this browser and network. Refreshes last_seen at most
 * once a day per link, so a busy account isn't a write per page load.
 */
export async function recordSecurityLinks(db: Database, userId: string, signals: HashedSignals): Promise<void> {
  const rows = [
    ...(signals.device ? [{ kind: "device" as const, hash: signals.device, userId }] : []),
    ...(signals.network ? [{ kind: "network" as const, hash: signals.network, userId }] : []),
  ];
  if (rows.length === 0) return;
  await db
    .insert(schema.securityLinks)
    .values(rows)
    .onConflictDoUpdate({
      target: [schema.securityLinks.kind, schema.securityLinks.hash, schema.securityLinks.userId],
      set: { lastSeenAt: sql`now()` },
      setWhere: sql`${schema.securityLinks.lastSeenAt} < now() - interval '1 day'`,
    });
}

/** Drops links past their retention. Bounded per run; a backlog clears over a few days. */
export async function purgeSecurityLinks(db: Database, limit = 5_000): Promise<{ deleted: number }> {
  const result = await db.execute<{ count: number }>(sql`
    with doomed as (
      select kind, hash, user_id from ${schema.securityLinks}
      where (kind = 'network' and last_seen_at < now() - ${`${NETWORK_RETENTION_DAYS} days`}::interval)
         or (kind = 'device' and last_seen_at < now() - ${`${DEVICE_RETENTION_DAYS} days`}::interval)
      limit ${limit}
    ), gone as (
      delete from ${schema.securityLinks} l using doomed d
      where l.kind = d.kind and l.hash = d.hash and l.user_id = d.user_id
      returning 1
    )
    select count(*)::int as count from gone
  `);
  return { deleted: Number(result.rows[0]?.count ?? 0) };
}

/** Removes every link of an account, e.g. when it's closed. */
export async function forgetSecurityLinks(db: Database, userId: string): Promise<void> {
  await db.delete(schema.securityLinks).where(eq(schema.securityLinks.userId, userId));
}
