# Beta program: maintenance and operations

For developers who maintain the beta testing system, run a program, or move Renvia to a custom
domain. The design and the reasoning behind it are in [beta-testing-system.md](beta-testing-system.md);
this document covers how it is built, deployed, run and changed.

Last updated 2026-10-15, at commit `023d6ca`.

---

## 1. What exists

A private beta for a small group of testers (10 by default), with its own credits and a hard fal
budget, built into the existing Studio, API and admin.

| Area | Where | What it does |
| --- | --- | --- |
| Data | `packages/db/migrations/0035_beta_program.sql`, `packages/db/src/schema.ts` | 8 `beta_*` tables; `users.beta_credits`; beta columns on `credit_ledger`, `renders`, `segmentations`, `budget_reservations` |
| Money | `apps/api/src/lib/beta.ts`, `apps/api/src/lib/credits.ts` | Beta credit bucket, grants, expiry, program budget cap, who pays for a job |
| Enrollment | `apps/api/src/lib/betaEnrollment.ts` | Invitation tokens, capacity (max testers), redemption |
| Missions | `apps/api/src/lib/betaMissions.ts` | Missions verified from finished renders, selections and reports |
| Feedback | `apps/api/src/lib/betaFeedback.ts`, `apps/api/src/routes/betaFeedback.ts` | Reports, annotations, diagnostics, screenshots, known issues |
| Housekeeping | `apps/api/src/lib/betaHousekeeping.ts` | Daily: end expired testers, expire leftover credits, delete old screenshots |
| Tester API | `apps/api/src/routes/beta.ts` (`/api/beta/*`) | Join, `/beta/me`, onboarding flags, missions |
| Admin API | `apps/api/src/routes/admin/beta.ts`, `admin/betaFeedback.ts` (`/api/admin/beta/*`) | Programs, invitations, testers, grants, budget, missions, announcements, triage |
| Studio | `apps/studio/src/beta/` | Join page, welcome, beta tour, Beta button, Beta Program page, report drawer, threads |
| Admin | `apps/admin/src/pages/beta/` | Beta program pages and the Beta feedback inbox |
| Tests | `apps/api/test/beta*.test.ts` | 101 tests over money, enrollment, onboarding, feedback, housekeeping |

Git history: commits `d5a6ff4` (credits, budget, enrollment), `eff42ba` (Studio onboarding),
`8f03f2e` (feedback), `4a9b96c` (admin and housekeeping), `023d6ca` (admin sidebar).

### Rules the code relies on

Keep these true when changing anything nearby.

1. **A tester is an enrollment, never a role.** `users.role` is never changed by the beta.
2. **Beta credits live inside `credit_balance`.** The check `plan_credits + beta_credits <= credit_balance`
   means account-funded charges can't spend beta credits, and beta-funded charges can't spend
   anything else. Any new code that changes `credit_balance` must respect it. Existing examples:
   `planCredits.ts` (first period), `admin/userDetail.ts` (admin removal), `paypalSettlement.ts`
   (refund reversal).
3. **A tester's own credits are never spent silently.** A tester's job is beta-funded unless the
   request says `funding: "account"`, which the Studio only sends after the tester chooses it.
4. **Two budget holds per beta job.** The global fal cap (`reserveBudget`) and the program cap
   (`reserveProgramBudget`) must both pass. The global sum ignores `budget_reservations` rows that
   have a `beta_program_id`, because the same job's global hold already counts them.
5. **Diagnostics come from the server.** The browser never supplies a report's diagnostics; they
   are copied from the render's own records.

---

## 2. Infrastructure

| Piece | Where | Notes |
| --- | --- | --- |
| API | Vercel project **renvia-api** (root `apps/api`) | Live at `https://renvia-api.vercel.app` |
| Studio | Vercel project for `apps/studio` | Live at `https://renvia-studio.vercel.app` |
| Admin | Vercel project **renvia-admin** (`apps/admin`) | Live at `https://renvia-admin.vercel.app` |
| Database | Neon, project "Renvia DB 2", host `ep-super-unit-…` | Production. The free tier has 1 GB of Postgres |
| Images | Cloudflare R2, private; served through signed links from the API | Free tier is 10 GB; the API refuses new files at `app_settings.storage_cap_mb` |
| Auth | Clerk | Also sends beta invitation emails |
| Daily job | Vercel Cron, `GET /api/cron/sweep-renders` at 03:00 UTC (`apps/api/vercel.json`) | Includes the beta housekeeping |
| Frequent job | GitHub Actions `operations-sync.yml`, every 10 minutes | Needs repo secrets `RENVIA_API_URL` and `RENVIA_CRON_SECRET` |

### Environment variables used by the beta

| Variable | Project | Value now | Purpose |
| --- | --- | --- | --- |
| `STUDIO_URL` | renvia-api (Production) | `https://renvia-studio.vercel.app` | Invitation links are built from it. Clerk invitation emails are only sent when it is set |
| `ALLOWED_ORIGINS` | renvia-api | `http://localhost:5173,http://localhost:5174,https://renvia-studio.vercel.app,https://renvia-admin.vercel.app` | CORS, Clerk token `azp` check, and the payment return page |
| `CRON_SECRET` | renvia-api | (secret) | Protects `/api/cron/*` |
| `VITE_API_BASE_URL` | Studio and admin | `https://renvia-api.vercel.app` | Where the browser apps call the API |
| `VITE_STUDIO_URL` | admin (optional, not set) | — | Only used if the API doesn't return full invitation links |
| `VERCEL_GIT_COMMIT_SHA` | Studio (set by Vercel) | automatic | Recorded on feedback as the app version |

Change a variable with the Vercel CLI, which is installed in `apps/api` as a dev dependency:

```bash
cd apps/api
npx vercel env ls production
npx vercel env rm STUDIO_URL production
printf 'https://studio.example.com' | npx vercel env add STUDIO_URL production
```

**Variables only take effect on a new deployment.** Pushing a commit that doesn't touch
`apps/api` does **not** rebuild the API: Vercel cancels it ("Canceled" in `vercel ls`). After changing
an API variable, redeploy explicitly:

```bash
npx vercel ls --environment production          # copy the newest "Ready" URL
npx vercel redeploy <that-url> --target production
```

---

## 3. Deploying changes

Commits go straight to `main`, and pushing to `main` deploys every project whose files changed.

### Database changes

Migrations are hand-written SQL in `packages/db/migrations/`, plus an entry in
`migrations/meta/_journal.json`. **Nothing runs them automatically.** Apply them to production
**before** pushing code that needs them, or every request that touches the new columns fails.

`packages/db/.env` contains **two** `DATABASE_URL` lines: production (`ep-super-unit`) first, and the
old locked database (`ep-muddy-term`) second. Don't rely on dotenv choosing one; pass production
explicitly:

```bash
cd packages/db
URL="$(grep -o 'DATABASE_URL=.*ep-super-unit.*' .env | head -1 | cut -d= -f2-)"
DATABASE_URL="$URL" npx drizzle-kit migrate
```

Then check the change is there before pushing, for example with `psql "$URL" -c "\d beta_programs"`.

Migration `0035_beta_program` was applied to production on 2026-10-15.

### Running the tests

The API tests run against a real local Postgres, never a hosted one (see `apps/api/test/README.md`).
On Windows, **create the test database as UTF8**: the default Windows encoding (`WIN1252`) makes
any test that stores characters such as "→" or "—" fail.

```bash
initdb -D .pgtest -U postgres -A trust
pg_ctl -D .pgtest -o "-p 54329" -l .pgtest/log start
psql -h 127.0.0.1 -p 54329 -U postgres -c "create database renvia_test encoding 'UTF8' template template0 lc_collate 'C' lc_ctype 'C'"

pnpm --filter @renvia/api test                                   # everything, about 5 minutes
cd apps/api && npx vitest run test/betaFeedback.test.ts         # one file, under a minute
```

**Run only one test process at a time.** Every run drops and rebuilds the test schema at start, so
two overlapping runs break each other and show dozens of unrelated timeouts.

After adding admin routes or audit actions, update the snapshot:
`npx vitest run test/adminRoutes.test.ts -u`.

---

## 4. Running a beta program

Everything is in the admin under **Beta → Beta program** and **Beta → Beta feedback**.

| Who | Can |
| --- | --- |
| admin | Everything, including creating programs, settings, budget and missions |
| support | Invite testers; suspend, reactivate, extend, complete or revoke them; post announcements; triage feedback |
| billing | Grant extra beta credits |
| analyst | Read only |

1. **Create** a program (New program). It starts as a draft: 10 testers, 25 credits each, 21 days,
   and a $10 budget, which is the most that can be set at creation.
2. **Configure** it under Settings: the welcome text, downloads, extra features, and render limits.
   Add **Missions** and an **Announcement**.
3. **Start** it.
4. **Invite** people from the Invitations tab:
   - An email that already has a Renvia account becomes an in-app invitation for that account.
   - A new email gets a Clerk invitation email.
   - A shareable link can admit several people.
   - Links are shown **once**, so copy them straight away. Each pending invitation holds a place
     until it is used, revoked or expires.
5. **Watch** spend on the program page. An operational incident opens at the warning threshold
   (80%) and again at 100%; at 100% new beta jobs are refused. Raising the budget is the
   **Change budget** button. Increases at or above the governance refund threshold need a second
   admin in Approvals. The global fal cap is never changed by this.
6. **Triage** reports in Beta feedback. "Ready to verify" asks the tester to confirm a fix. Mark
   known issues so other testers can say "I have this too" instead of reporting the same problem.
7. **End** the program. Every tester is completed and their beta credits expire. Their projects,
   plan and own credits are untouched.

When a tester runs out of beta credits, the Studio offers **Use my own credits**. Until they choose
it, nothing is charged to their account.

---

## 5. Moving to a custom domain

### The one thing to get right: the API's address is stored in the data

Every image Renvia stores is saved as a URL that includes the API's origin, for example
`https://renvia-api.vercel.app/api/uploads/...`. The API only recognises, re-signs and serves URLs
whose origin matches its **own current origin** (`ownUploadKey` in `apps/api/src/lib/storage.ts`).

So, depending on what moves:

- **Moving the Studio, admin or marketing site** to a custom domain is safe. Follow the checklist
  below.
- **Moving the API** to a new domain breaks every existing image, render, reference and thumbnail,
  and edits that start from them. **Recommendation: keep the API on `renvia-api.vercel.app`.**
  Users never see the API's address, so there is no benefit to moving it.

If the API must move anyway, first do **one** of the following in a separate, tested change:

1. **Accept legacy origins in code.** For example, a `LEGACY_API_ORIGINS` variable that
   `ownUploadKey` also accepts. Old URLs then keep working and new ones use the new domain.
2. **Rewrite stored URLs in the database.** Replace the old origin with the new one in
   `renders.source_image_url`, `renders.result_image_url`, `renders.settings` (JSON),
   `canvas_nodes.data` (JSON), `reference_images.url` and `projects.thumbnail_url`. Do it in a
   transaction, after a Neon branch backup.

Keep the old API domain working throughout. Vercel keeps `*.vercel.app` aliases alive, so old links
still resolve.

### Checklist: moving the Studio (e.g. to `studio.renvia.com`)

1. Add the domain to the Studio's Vercel project and wait for its certificate.
2. **Clerk:** add the domain to the production instance's allowed origins and redirect URLs. Check
   that sign-in, sign-up, SSO and invitation redirects all land on the new domain.
3. **API `ALLOWED_ORIGINS`:** add `https://studio.renvia.com`, keeping the old origin until all
   traffic has moved. This governs CORS, the Clerk token check, and where PayPal and Paystack
   return after payment.
4. **API `STUDIO_URL`:** set it to `https://studio.renvia.com`. New invitation links and Clerk
   invitation emails use it. Links already sent keep working only while the old Studio domain does.
5. **Redeploy the API** (see §2), because variables don't apply until a new deployment.
6. **Paystack and PayPal dashboards:** if they hold a fixed callback or website URL, update it.
   The API itself sends the return URL with each checkout.
7. **Marketing site:** update links to the Studio (`apps/marketing/lib`).
8. **Admin:** if invitation links show as a bare `/beta/join?…` path, `STUDIO_URL` isn't set on the
   running API deployment. Optionally set `VITE_STUDIO_URL` on the admin project as a fallback.
9. **Test after the switch:**
   - Sign in.
   - Open a project and confirm images load.
   - Render.
   - Accept an invitation link.
   - Complete a test payment.

### Checklist: moving the admin (e.g. to `admin.renvia.com`)

1. Add the domain to the admin's Vercel project.
2. Add it to the API's `ALLOWED_ORIGINS` and Clerk's allowed origins, then redeploy the API.
3. Sign in to the admin and open Beta program to confirm the API answers.

---

## 6. Known gaps and gotchas

- **Downloads for Free-plan users are only locked in the browser** (decision D6 in the spec). A beta
  program's "downloads unlocked" setting only lifts that client-side lock.
- **The full API test suite** wasn't run in one clean pass after the beta work, because runs kept
  being interrupted. All 101 beta tests and the other affected files passed individually. Run the
  whole suite once before inviting real testers.
- **No end-to-end browser tests** (Stage 7 was skipped, because the admin is behind sign-in).
- **Drizzle raw SQL:** in a query that reads a single table, Drizzle writes column references
  without the table name. Inside a correlated subquery, `${schema.betaFeedback.id}` can therefore
  silently mean the subquery's own `id`. Write the outer column as `beta_feedback.id` (see
  `awaitingSql` and `plusOnesSql`). This bug was caught by tests once already.
- **Admin sidebar:** new admin pages must be added to an entry in `ADMIN_NAV` (`apps/admin/src/lib/nav.ts`)
  **and** to a sidebar group in `Sidebar` (`apps/admin/src/App.tsx`), or they won't appear.
  `navForPath` matches prefixes, checking later entries first, so a longer path such as
  `/beta-feedback` must come after `/beta` in `ADMIN_NAV`.
- **Credit prices:** check the live Studio Control revision's published prices before a program
  starts. The cost table in the spec uses Settings' defaults.
- **Storage:** feedback screenshots count toward the R2 cap. They are capped at 500 MB per program
  by default, 20 per tester and 1 MB each, and deleted 90 days after the report closes. Settings
  shows "Beta screenshots" in the storage breakdown.
