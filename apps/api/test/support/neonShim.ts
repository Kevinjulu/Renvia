import pg from "pg";
import { neonConfig } from "@neondatabase/serverless";

/**
 * The API talks to Neon over its HTTP SQL protocol. This routes that protocol to a local
 * Postgres so tests run the real production code paths (including `db.batch` transactions,
 * check constraints and advisory locks) without a network or a Neon account.
 *
 * Wire format mirrors Neon's: single `{ query, params }` or a `{ queries: [...] }` batch run in
 * one transaction; rows come back as raw text arrays and the driver parses them by type OID.
 */
const rawText = { getTypeParser: () => (value: string) => value };

type WireQuery = { query: string; params?: unknown[] };

let pool: pg.Pool | null = null;

export function getPool(connectionString: string): pg.Pool {
  // Neon sessions run in UTC. Match it, or day-grouped SQL depends on the machine's time zone.
  pool ??= new pg.Pool({ connectionString, max: 10, options: "-c timezone=UTC" });
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = null;
}

async function run(client: pg.Pool | pg.PoolClient, { query, params }: WireQuery) {
  const result = await client.query({ text: query, values: params ?? [], rowMode: "array", types: rawText });
  return {
    command: result.command,
    rowCount: result.rowCount,
    rows: result.rows,
    fields: result.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
    rowAsArray: true,
  };
}

function errorResponse(error: unknown): Response {
  const e = error as Record<string, unknown> & { message?: string };
  // Same shape Neon returns for a failed statement; the driver copies these onto the thrown error.
  const body = { ...e, message: e.message ?? String(error) };
  return new Response(JSON.stringify(body), { status: 400, headers: { "content-type": "application/json" } });
}

export function installNeonShim(connectionString: string): void {
  const db = getPool(connectionString);
  neonConfig.fetchFunction = async (_url: unknown, init: { body?: string }) => {
    const payload = JSON.parse(init.body ?? "{}") as WireQuery & { queries?: WireQuery[] };
    try {
      if (payload.queries) {
        const client = await db.connect();
        try {
          await client.query("begin");
          const results = [];
          for (const q of payload.queries) results.push(await run(client, q));
          await client.query("commit");
          return Response.json({ results });
        } catch (error) {
          await client.query("rollback").catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }
      }
      return Response.json(await run(db, payload));
    } catch (error) {
      return errorResponse(error);
    }
  };
}
