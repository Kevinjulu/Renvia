# RΞNVIA

AI-powered architectural visualization SaaS. Customers upload an elevation or
sketch, work on an infinite canvas, and generate photoreal renders and masked
edits. Usage is metered in credits, paid for through PayPal, and controlled by a
role-gated operator console.

## Status

| Area | State |
|---|---|
| Studio (rendering, edits, selections, dashboard, billing page) | Shipping |
| Admin console (13 routes, 5 staff roles, audit, incidents) | Shipping. Approval requests and their thresholds are API-only (no UI yet) |
| API (renders, credits, budget cap, uploads, billing, admin, cron) | Shipping |
| Marketing site (landing, pricing, blog, legal) | Shipping |
| PayPal checkout and webhooks | **Built and tested; disabled until credentials are set** (see [PayPal](#paypal)) |
| Automated tests | API (credits, refunds, budget, PayPal, admin), one studio unit test, fixture check. Browser e2e is manual |
| CI | GitHub Actions: lint, typecheck, build, tests ([.github/workflows/ci.yml](.github/workflows/ci.yml)) |

## Structure

```
apps/
  marketing/   Next.js 15 (App Router, static export): public site
  studio/      Vite + React 18 SPA: the customer product (canvas, dashboard, billing)
  admin/       Vite + React 18 SPA: operator console
  api/         Hono on Vercel Functions: the shared backend, mounted under /api
packages/
  db/          Drizzle schema, client (Neon HTTP driver) and SQL migrations
  types/       Shared TypeScript types: API contracts and status enums
  config/      Shared tsconfig / eslint base configs
tests/
  render-fidelity/   Source-fidelity regression pack and fixtures
docs/                Design notes for source fidelity and upload compression
```

Each app deploys as its own Vercel project. They share the database schema,
types and API contracts through `packages/*` via the pnpm workspace protocol.

## Stack

| Layer | Choice |
|---|---|
| Package manager | pnpm workspaces + Turborepo |
| Marketing | Next.js 15, React 19, Tailwind CSS 3, Motion |
| Studio | Vite, React 18, react-konva (Konva.js), Zustand, Clerk |
| Admin | Vite, React 18, Tailwind CSS 3, lucide-react, Clerk |
| API | Hono on Vercel Functions, Zod |
| Auth | Clerk (session tokens verified locally in the API) |
| Database | Postgres (Neon) via Drizzle ORM |
| File storage | Neon Object Storage (S3-compatible), served through expiring signed links |
| AI rendering | fal.ai via `@fal-ai/client` (queue submit, webhook, status poll) |
| Payments | PayPal (one-off credit packs and subscriptions) |
| Tests | Vitest (API), Node's test runner (studio), Playwright (studio e2e) |

## Getting started

Requires Node 20+ (Node 22.18+ to run the studio unit test) and pnpm 11.

```bash
pnpm install
cp .env.example .env   # fill in values, see below
pnpm dev               # boots every app via Turborepo
```

| App | Port | URL |
|---|---|---|
| marketing | 3000 | http://localhost:3000 |
| studio | 5173 | http://localhost:5173 |
| admin | 5174 | http://localhost:5174 |
| api | 8787 | http://localhost:8787/api/health |

`GET /api/health` always returns 200 and needs no auth. Every other API route
verifies a Clerk session token, so without `CLERK_SECRET_KEY` they answer 401.

### Common commands

```bash
pnpm lint            # eslint across the workspace
pnpm typecheck       # tsc across the workspace
pnpm build           # production builds
pnpm test            # API + studio unit tests, then the render-fixture check
pnpm db:generate     # new migration from packages/db/src/schema.ts
pnpm db:migrate      # apply migrations to DATABASE_URL
```

## Environment variables

Copy `.env.example` to `.env` at the repo root. Variables fall into three groups
by where they are read.

**API project** (`apps/api`; set in that Vercel project, or in `apps/api/.env.local`
for local work). Server-only: never give these a `VITE_` or `NEXT_PUBLIC_` prefix.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string |
| `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Clerk, for verifying session tokens |
| `ALLOWED_ORIGINS` | Comma-separated Studio and Admin origins: CORS and Clerk authorized-party check. Must include the admin origin |
| `FAL_KEY` | fal.ai API key |
| `FAL_MODE` | `mock` (default: free placeholder results, no fal calls), `dev` (cheapest model) or `prod`. Anything else falls back to `mock` |
| `FAL_BUDGET_USD` | Hard cap on total estimated fal spend. Unset or `0` blocks all paid renders |
| `NEON_STORAGE_ACCESS_KEY_ID`, `NEON_STORAGE_SECRET_ACCESS_KEY`, `NEON_STORAGE_ENDPOINT`, `NEON_STORAGE_BUCKET`, `NEON_STORAGE_REGION` | Object storage for uploads and generated renders |
| `STORAGE_URL_SIGNING_SECRET` | Long random secret for seven-day expiring image links. Objects are not anonymously public |
| `CRON_SECRET` | Bearer token for the daily render sweep. Unset disables the endpoint |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_ENV` | PayPal. Optional: see [PayPal](#paypal) |
| `OPS_NOTIFICATION_WEBHOOK_URL` | Optional HTTPS endpoint for incident notifications |

`FAL_MODE` and `FAL_BUDGET_USD` can be overridden at runtime from the admin
Settings page without a redeploy (blank means "use the env var").

**Studio** (`apps/studio/.env.local`, public): `VITE_CLERK_PUBLISHABLE_KEY`,
`VITE_API_BASE_URL`, `VITE_MARKETING_URL`, `VITE_UNSPLASH_ACCESS_KEY`.

**Admin** (`apps/admin/.env.local`, public): `VITE_CLERK_PUBLISHABLE_KEY`,
`VITE_API_BASE_URL`.

**Marketing** (public): `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_STUDIO_URL`.

Only `VITE_`-prefixed variables reach the browser. Never widen Vite's `envPrefix`
or give a browser app server secrets: Clerk's SDK makes Vite inline every
variable matching the prefix into the public bundle.

## Credits

1 credit = 1 image (the per-image and per-selection prices are admin settings,
default 1). New users get a one-time signup bonus (default 25). The Starter plan
and the default limits (5 renders a day, 2 projects) keep a free account from
spending the whole grant in one burst.

- `POST /renders` debits the balance in the same transaction that creates the
  render. A database check keeps the balance from going negative, so concurrent
  clicks cannot overspend. Every failure path refunds, and a refund can only be
  applied once per render.
- `credit_ledger` records every change, including admin adjustments and
  purchases. `GET /me/credits` returns a user's balance and history.
- Users with the `admin` role are not charged for renders.

## Spend control

Rendering costs real money, so it is gated three ways:

1. **Mode.** `FAL_MODE` defaults to `mock`, which never calls fal.
2. **Global budget.** `FAL_BUDGET_USD` caps total estimated spend. A paid job takes
   a short-lived reservation under a database lock before it is created, so
   simultaneous requests cannot overshoot the cap. Failed jobs are not counted.
3. **Per-user limits.** Daily and monthly render and selection limits, a project
   cap, and per-user overrides, all editable in the admin console.

A daily cron (`/api/cron/sweep-renders`, see `apps/api/vercel.json`) advances renders
whose webhook never arrived (and fails those stuck too long), then syncs
operational incidents.

## Billing

Plans, credit packs, checkouts, payments, invoices and webhook events are
provider-neutral tables, so another provider can be added without reshaping them.
Only PayPal is wired up.

- Every account has an entitlement; new accounts get the `starter` plan.
- A credit-pack purchase settles only when a verified payment matches an existing
  Renvia checkout's PayPal order, currency and amount, and settles exactly once
  even when the return flow and the webhook race.
- Refunds reverse the purchased credits, and only while those credits are unspent.
  Otherwise the refund needs manual review.
- Large bulk credit grants and role changes are held for a second administrator's
  approval. The refund and maintenance thresholds can be saved but are **not
  enforced yet**. The approval endpoints and thresholds are API-only for now
  (`GET`/`PUT /api/admin/governance` and
  `POST /api/admin/approvals/:id/{approve,reject,execute}`); there is no admin
  screen for them yet.

### PayPal

PayPal is fully built but stays **off until you add credentials**. With any of the
first three variables empty, checkout is unavailable and `POST /api/webhooks/paypal`
answers 503. Nothing else is affected, and the tests run without them.

Add these to the **API project** (never `VITE_*`):

- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `PAYPAL_WEBHOOK_ID`: the webhook ID, not the client ID
- `PAYPAL_ENV=sandbox` for the sandbox app, or omit it for live

Then, in the PayPal dashboard, subscribe the app to at least
`PAYMENT.CAPTURE.COMPLETED` and `PAYMENT.CAPTURE.REFUNDED` (add the
`BILLING.SUBSCRIPTION.*` events for subscriptions) with the deployed HTTPS URL
ending in `/api/webhooks/paypal`.

The API accepts callbacks at `POST /api/webhooks/paypal` and verifies every
delivery with PayPal server-to-server before recording or settling it. Browser
redirects and unverified callbacks never grant credits or an entitlement. The
admin Billing page shows delivery failures without exposing provider payloads and
can replay a failed event.

## Admin console

`apps/admin` is a separate app (its own Vercel project) on the same Clerk
instance, calling the role-gated `/api/admin/*` routes.

| Page | What it does |
|---|---|
| Overview | Users, renders, failure rate, spend against budget, daily renders, top users |
| Users, User detail | Search; grant or remove credits, disable, change role, limit overrides, notes, tags, revoke sessions |
| Projects, Renders, Segmentations | Browse; refresh, cancel or recover stuck and failed work |
| Credits | The full credit ledger |
| Billing, Financials, Operations | Payments, refunds, webhook replay, revenue and margin, work queue |
| Incidents | Open, acknowledge, assign and resolve operational incidents |
| Audit | Every staff action, with immutable CSV exports |
| Settings | Signup bonus, limits, prices, messages, maintenance mode, engine mode and budget |

**Roles** live in `users.role` (not Clerk metadata): `user`, `analyst`, `support`,
`billing`, `admin`. Each role has an explicit permission list in
`apps/api/src/routes/admin/permissions.ts`, and every route checks it. Grant the
first admin with SQL:

```sql
update users set role = 'admin' where email = '<you>';
```

After that, roles are managed from the dashboard.

The admin API is split by area under `apps/api/src/routes/admin/`, one router per
page, mounted in `index.ts`. Hono matches in registration order, so keep that
order when adding routes.

## Database

26 tables and 27 migrations. The schema is
[packages/db/src/schema.ts](packages/db/src/schema.ts).

| Area | Tables |
|---|---|
| Accounts | `users` |
| Product | `projects`, `canvas_nodes`, `renders`, `reference_images`, `segmentations` |
| Credits and spend | `credit_ledger`, `budget_reservations` |
| Billing | `billing_plans`, `user_entitlements`, `credit_packs`, `billing_checkouts`, `billing_payments`, `billing_invoices`, `billing_webhook_events` |
| Operations | `app_settings`, `incidents`, `incident_events`, `incident_notifications` |
| Governance | `admin_events`, `customer_notes`, `customer_tags`, `governance_settings`, `approval_requests`, `approval_events`, `audit_exports` |

```bash
pnpm db:generate   # generate a migration after editing schema.ts
pnpm db:migrate    # apply migrations to DATABASE_URL
```

`packages/db` uses `drizzle-orm/neon-http` rather than a TCP driver, because the
API runs in a serverless environment. Neon runs a `db.batch([...])` as one
transaction, which the credit and settlement code relies on.

## Testing

```bash
pnpm test
```

- **API** (`apps/api/test`, Vitest): credits and refunds, the budget cap, PayPal
  settlement and webhooks, and the whole admin API (route table, per-role
  permissions, response shapes, write paths). They run the real code against a real
  local Postgres, with the Neon HTTP protocol routed to it, and need
  `TEST_DATABASE_URL`. The run wipes that database and refuses non-local hosts.
  Setup and details: [apps/api/test/README.md](apps/api/test/README.md).
- **Studio**: `node --test` unit tests, plus a Playwright auth e2e
  (`pnpm --filter @renvia/studio test:e2e`) that needs real Clerk keys.
- **Render fidelity**: `pnpm test:render-fixtures` checks the fixture files by
  hash. Judging a render is manual; see
  [tests/render-fidelity/README.md](tests/render-fidelity/README.md).

No PayPal, Clerk, fal or Neon credentials are needed for `pnpm test`.

## CI

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on every push to `main`
and every pull request: install, lint, typecheck, build, then `pnpm test` against a
Postgres service container. It uses no secrets.

## Notes

- Marketing uses React 19 (Next 15's default pairing); Studio and Admin use React 18.
- Tailwind is pinned to v3 (`tailwind.config.ts`).
- Renders flow through `apps/api/src/lib/engine.ts`: `POST /renders` submits to the
  fal queue, and jobs complete via the `/webhooks/fal` callback (public
  deployments) or on the next `GET /renders/:id` poll (local dev, and as a
  fallback). Results are copied into our own storage, since fal URLs expire.
- Build output (`dist/`, `*.tsbuildinfo`) is not tracked. `packages/db` and
  `packages/types` are built by `pnpm build`, which `lint` and `typecheck` depend on.

### Environment-specific fixes in `pnpm-workspace.yaml`

- **`turbo` is pinned to `2.3.3`** (exact, not `^`). Turbo `2.10.12`'s Windows
  binary segfaulted on the development machine; `2.3.3` is stable there. Revisit
  if you need a newer Turbo feature.
- **`packageExtensions`** add `@types/react` as an optional peer of
  `@clerk/react`, `react-konva`, `react-router-dom` and `react-router`, and
  `@types/react` plus `@types/react-dom` to `next`. Studio and Admin pin React 18
  and Marketing pins React 19, and none of those packages declare `@types/react`
  themselves, so pnpm's fallback resolution picked the wrong major and broke JSX
  types. This makes pnpm resolve `@types/react` per consumer, the same way it
  resolves `react`.
- **Test-only dependencies at the root.** `pg`, `@types/pg` and
  `@neondatabase/serverless` sit in the root `package.json` on purpose: adding
  them to `apps/api` makes pnpm create a second copy of `drizzle-orm` there and
  breaks the types shared with `packages/db`.
