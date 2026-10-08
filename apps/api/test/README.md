# API tests

Vitest suites for the money paths: credit charging and refunds, the fal budget cap, and PayPal
settlement and webhooks. They run the production code against a **real Postgres**, because the
guarantees under test (check constraints, unique indexes, transactions, advisory locks) live in the
database.

The API talks to Neon over HTTP. `test/support/neonShim.ts` routes that protocol to a local Postgres,
so no Neon account or network is involved. PayPal's API is stubbed and every credential in the tests
is a placeholder; **no PayPal variables are needed to run them.**

## Run

```bash
export TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/renvia_test
pnpm --filter @renvia/api test
```

`TEST_DATABASE_URL` defaults to `postgres://postgres:postgres@127.0.0.1:54329/renvia_test`. The run
drops and rebuilds the `public` schema from `packages/db/migrations`, and truncates every table
between tests, so it **refuses to start unless the host is local**. Never point it at a hosted database.

A throwaway local cluster (no Docker needed if PostgreSQL is installed):

```bash
initdb -D .pgtest -U postgres -A trust && pg_ctl -D .pgtest -o "-p 54329" -l .pgtest/log start
psql -h 127.0.0.1 -p 54329 -U postgres -c "create database renvia_test"
```

CI uses a `postgres:16` service container (see `.github/workflows/ci.yml`).
