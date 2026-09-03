# RΞNVIA

AI-powered architectural/design visualization SaaS. Monorepo scaffold — no
feature logic yet, just the structure everything else gets built on.

## Structure

```
apps/
  marketing/   Next.js 15 (App Router, static export) — public landing site
  studio/      Vite + React 18 SPA — gated, infinite-canvas product
  api/         Hono on Cloudflare Workers — shared backend
packages/
  db/          Drizzle schema + client (Postgres via Neon, HTTP driver)
  types/       Shared TypeScript types (API contracts, job status enums)
  config/      Shared tsconfig / eslint base configs
```

Marketing and Studio deploy independently (different rendering needs — static
SSG vs. client-only SPA); both share the database schema, types, and API
contracts through `packages/*` via the pnpm workspace protocol.

## Stack

| Layer | Choice |
|---|---|
| Package manager | pnpm workspaces + Turborepo |
| Marketing | Next.js 15, Tailwind CSS, Motion |
| Studio | Vite, React 18, react-konva (Konva.js), Zustand, Clerk |
| API | Hono on Cloudflare Workers |
| Database | Postgres (Neon) via Drizzle ORM |
| File storage | Cloudflare R2 |
| Async jobs | Inngest |
| AI orchestration | Vercel AI SDK — `@ai-sdk/fal` (primary), `@ai-sdk/replicate` (fallback/custom models) |

## Getting started

```bash
pnpm install
cp .env.example .env   # fill in values, see below
pnpm dev                # boots all three apps concurrently via Turborepo
```

| App | Port | URL |
|---|---|---|
| marketing | 3000 | http://localhost:3000 |
| studio | 5173 | http://localhost:5173 |
| api | 8787 | http://localhost:8787 |

Verify the scaffold:
- `apps/marketing` renders a placeholder homepage at `/`.
- `apps/studio` redirects `/` → `/login`, and `/project/:projectId` renders a
  placeholder canvas route with a working Konva stage (pan/zoom).
- `apps/api` responds `200 OK` on `GET /health`.

## Environment variables

Copy `.env.example` to `.env` at the repo root and fill in:

- `DATABASE_URL` — Neon Postgres connection string.
- `CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` — from the Clerk dashboard.
  Studio reads `CLERK_PUBLISHABLE_KEY` client-side (Vite's `envPrefix` is
  widened in `apps/studio/vite.config.ts` to expose it without a `VITE_` prefix).
- `FAL_KEY` — primary AI image provider (fal.ai).
- `REPLICATE_API_TOKEN` — fallback/custom-model provider.
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` —
  Cloudflare R2 for uploaded source images and generated renders.
- `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` — async render job queue.

`apps/api` runs on Cloudflare Workers, so in production these are set as
Worker secrets (`wrangler secret put <NAME>`) rather than read from a `.env`
file; `wrangler dev` picks up a local `.dev.vars` file (gitignored) for
local development, or you can export them into your shell before `pnpm dev`.

## Database

```bash
pnpm db:generate   # generate a migration from packages/db/src/schema.ts
pnpm db:migrate    # apply migrations to DATABASE_URL
```

Schema lives in [packages/db/src/schema.ts](packages/db/src/schema.ts):
`users`, `projects`, `canvas_nodes`, `renders`, `credit_ledger`.

## Notes / assumptions made during scaffolding

- Marketing uses React 19 (Next 15's default pairing); Studio is pinned to
  React 18 per the brief.
- Tailwind is pinned to v3 (`tailwind.config.ts`) rather than v4, to match
  the JS-config file explicitly listed in the brief.
- `packages/db`'s client uses `drizzle-orm/neon-http` (not `node-postgres`),
  since `apps/api` runs on Cloudflare Workers, which can't hold raw TCP
  connections — this driver works from both Node and Workers.
- Route handlers in `apps/api` (`renders`, `uploads`, `webhooks/fal`,
  `jobs/generateRender`) are structurally wired (typed, mounted, auth-gated)
  but return placeholder data — no DB writes or real AI calls yet, per the
  scaffolding-only brief.
- Protected `apps/api` routes (`/renders`, `/uploads`) return a 500 in local
  dev until `CLERK_SECRET_KEY` is set — `@hono/clerk-auth` throws on a
  missing key rather than degrading to "unauthenticated". `/health` doesn't
  require auth and always returns 200.

## Environment-specific fixes baked into `pnpm-workspace.yaml`

Verifying this scaffold (`pnpm install`, typecheck, `pnpm dev`, `pnpm build`,
all green) surfaced three non-obvious issues, fixed at the root rather than
worked around:

- **`turbo` pinned to `2.3.3`** (exact, not `^`). Turbo `2.10.12`'s
  Windows binary segfaulted on this machine (`turbo --version` alone
  crashed); `2.3.3` is confirmed stable here. Worth revisiting if you
  need a newer Turbo feature.
- **`packageExtensions`** inject `@types/react` as a peer dependency onto
  `@clerk/clerk-react`, `react-konva`, `react-router-dom`, and
  `react-router`. Studio pins React 18 and Marketing pins React 19; none of
  those four packages declare `@types/react` themselves, so pnpm's fallback
  type resolution silently picked up Marketing's React 19 types inside
  Studio's build, breaking every JSX component from those libraries. This
  makes pnpm resolve `@types/react` per-consumer, the same way it already
  does for `react` itself.
- **`zod` pinned to `^3.25.0`** as an explicit `apps/api` dependency.
  `inngest` needs `zod@^3.25.0` (for its `zod/v3` compat subpath), but
  without an explicit edge pnpm deduped it against the older `zod@3.22.3`
  pulled in by the `@ai-sdk/*` packages, crashing Wrangler's bundler.
