# RΞNVIA

AI-powered architectural/design visualization SaaS. Monorepo scaffold — no
feature logic yet, just the structure everything else gets built on.

## Structure

```
apps/
  marketing/   Next.js 15 (App Router, static export) — public landing site
  studio/      Vite + React 18 SPA — gated, infinite-canvas product
  admin/       Vite + React 18 SPA — admin dashboard (users, credits, usage, settings)
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
| Async jobs | fal queue (submit + webhook / status poll) |
| AI rendering | fal.ai via `@fal-ai/client` (queue submit, storage, webhooks) — see `apps/api/src/lib/engine.ts` |

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
| admin | 5174 | http://localhost:5174 |
| api | 8787 | http://localhost:8787 |

Verify the scaffold:
- `apps/marketing` renders a placeholder homepage at `/`.
- `apps/studio` redirects `/` → `/login`, and `/project/:projectId` renders a
  placeholder canvas route with a working Konva stage (pan/zoom).
- `apps/api` responds `200 OK` on `GET /health`.

## Environment variables

Copy `.env.example` to `.env` at the repo root and fill in:

- `DATABASE_URL` — Neon Postgres connection string.
- `CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` — from the Clerk dashboard, for
  the API. The studio instead reads `VITE_CLERK_PUBLISHABLE_KEY` (plus
  `VITE_API_BASE_URL`, `VITE_UNSPLASH_ACCESS_KEY`) from `apps/studio/.env.local`.
  Only `VITE_`-prefixed vars reach the browser — never widen Vite's `envPrefix`
  or give the studio server secrets: Clerk's SDK makes Vite inline every var
  matching the prefix into the public bundle.
- `FAL_KEY` — primary AI image provider (fal.ai).
- `FAL_MODE` — `mock` (default: free placeholder results, no fal calls), `dev`
  (cheapest model) or `prod`. Anything else falls back to `mock`.
- `FAL_BUDGET_USD` — hard cap on total estimated fal spend; `POST /renders`
  returns 402 once reached. Unset blocks all paid renders.
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` —
  Cloudflare R2 for uploaded source images and generated renders.

`apps/api` runs on Cloudflare Workers, so in production these are set as
Worker secrets (`wrangler secret put <NAME>`) rather than read from a `.env`
file; `wrangler dev` picks up a local `.dev.vars` file (gitignored) for
local development, or you can export them into your shell before `pnpm dev`.

## Admin dashboard

`apps/admin` is a separate app (its own Vercel project) on the same Clerk
instance, calling the role-gated `/api/admin/*` routes:

- **Overview** — users, renders, failure rate, fal spend against the budget,
  renders per day, spend per model, top users.
- **Users** — search; per user: grant/remove credits (with a note, recorded in
  the ledger), disable/enable, make/remove admin, credit history, renders.
- **Renders** — every render and edit with thumbnails, filterable by status.
- **Settings** — signup bonus, per-user daily render limit, render mode and
  budget cap. These live in the `app_settings` table and override `FAL_MODE` /
  `FAL_BUDGET_USD` without a redeploy (blank = use the env var).

Access: the admin role is stored in `users.role` (not Clerk metadata). Grant it
from the dashboard, or for the first admin run
`update users set role = 'admin' where email = '<you>';`.

Env (`apps/admin/.env.local`, all public): `VITE_CLERK_PUBLISHABLE_KEY`,
`VITE_API_BASE_URL`. **Its origin must be added to the API's `ALLOWED_ORIGINS`**
(e.g. `http://localhost:5174` locally, the admin domain on Vercel) — the API
uses that list for CORS and to reject session tokens minted for other origins.

## Credits

1 credit = 1 image. New users get the signup bonus (default 25) once; admins
aren't charged. `POST /renders` debits the balance in the same transaction that
creates the render (a balance can't go negative, so concurrent clicks can't
overspend) and every failure path refunds it. `credit_ledger` records every
change; `GET /me/credits` returns a user's balance and history.

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
- Renders flow through `apps/api/src/lib/engine.ts`: `POST /renders` submits
  to the fal queue, and jobs complete via the `/webhooks/fal` callback (public
  deployments) or on the next `GET /renders/:id` poll (local dev, and as a
  fallback). Results are copied into our storage, since fal's URLs expire.
- Protected `apps/api` routes (`/renders`, `/uploads`) return a 500 in local
  dev until `CLERK_SECRET_KEY` is set — `@hono/clerk-auth` throws on a
  missing key rather than degrading to "unauthenticated". `/health` doesn't
  require auth and always returns 200.

## Environment-specific fixes baked into `pnpm-workspace.yaml`

Verifying this scaffold (`pnpm install`, typecheck, `pnpm dev`, `pnpm build`,
all green) surfaced two non-obvious issues, fixed at the root rather than
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
  `next` gets the same edge (plus `@types/react-dom`): its own `.d.ts` files
  import `react`, and without it they resolved to the hoisted React 18 types
  and broke Marketing's typecheck/build once a second React 18 app (admin)
  was added.
