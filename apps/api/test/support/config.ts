/** Local default matches the throwaway cluster described in apps/api/test/README.md. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:54329/renvia_test";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Tests drop and truncate tables, so they must never be pointed at a hosted database. */
export function assertLocalDatabase(url: string): void {
  const { hostname } = new URL(url);
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(`Refusing to run API tests against non-local database host "${hostname}"`);
  }
}
