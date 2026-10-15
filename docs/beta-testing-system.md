# Renvia Beta Testing System — implementation spec

Status: approved 2026-10-15. Revised the same day for the first private program's scale.
Stages 1–6 (§11) are built, tested and deployed (migration 0035 applied to production on
2026-10-15). Stage 7 (end-to-end browser tests) remains, and no real invitations go out until the
release gate (§12) passes. Day-to-day running, deployment and custom-domain moves are covered in
[beta-operations.md](beta-operations.md).

**First program defaults.** All are editable in admin; the $10 budget is the only spend authorized.

| Setting | Default |
| --- | --- |
| Enrollment | Invitation only |
| Active testers | 10 at most, enforced at redemption; pending invitations hold slots |
| Beta credits | 25 per tester on enrollment, so 250 initially; top-ups by an operator, with approval above the governance threshold |
| Duration | 21 days by default, 14–21 at creation; whole-program and per-tester extensions |
| Provider budget | **$10** hard cap for beta-funded jobs; warnings at 80% ($8) and 100%; raised only by an audited admin action |
| Downloads | Allowed for active testers when the program enables them (default on); 4K/8K exports per program |
| Out of scope | Session replay, page-visit tracking, click tracking, behavioural timelines |

A beta credit is a usage unit, not a dollar amount. Granting credits or extending dates never raises
the program budget, and changing the program budget never changes the global fal cap.

**Actual costs**, from `apps/api/src/lib/models.ts` and `packages/types`, checked 2026-10-15. The
"Credits" column uses Settings' default prices (`legacyCreditPrices` with `creditsPerImage = 1`).
Published Studio Control prices override these values, so check the live revision before the
program starts.

| Job (prod engine) | Model | Budgeted cost | Credits |
| --- | --- | --- | --- |
| Photo / drawing render | `fal-ai/flux-pro/kontext` | $0.040 | 1 |
| Reference render | `blackforestlabs/flux-3/edit-image` | $0.048 | 1 |
| Strict-fidelity render | same | $0.048 | 2 |
| Edit, per pass | Kontext Pro (FLUX 3 with references) | $0.040–0.048 | 1 |
| 4K / 8K upscale | `bria/increase-resolution` | $0.040 / $0.080 | 1 / 2 |
| Auto-select | SAM | $0.005 | 1 |

At these prices, 250 credits spent entirely on standard renders cost $10.00. Spent on reference
renders, they cost $12.00. **The $10 cap is the binding limit**, which is why it is enforced
separately from credits. Costs are budgeted at fal's published standard rates. Failed passes are
reconciled downward on the job row (`failurePatch`, `cost_micros` reduced). fal doesn't report a
cost for each request, so budgeted cost is the figure the cap is enforced against.

This document is for whoever implements the system. It covers what testers see ("Beta Program"
in the Studio), what operators see ("Beta Management" in the admin app), and how each part fits
into the code that already exists. Each section names the files it touches.

**Scope.** Included: invitations, tester management, beta credits with a per-program spend cap,
welcome modal, guided tour, missions, announcements, known issues, visual feedback with image
pins and annotations, a feedback inbox, replies, program analytics and audit.

**Deliberately excluded:** session replay, clickstreams, page-visit histories, behavioural
timelines and any other activity stream. Feedback diagnostics come from records Renvia already
keeps (the render row, its `render_job_events`, the credit ledger), captured when the report is
filed.

---

## 1. What the audit found

The codebase already has most of the infrastructure this system needs. Building on it, rather
than beside it, is the main design constraint.

| Need | Existing piece | Where |
| --- | --- | --- |
| Identity | `users` row synced from Clerk; role enum `user, analyst, support, billing, admin` | `packages/db/src/schema.ts`, `apps/api/src/lib/users.ts` |
| Credit buckets | `users.credit_balance`, with `plan_credits` as a sub-bucket spent first. Debits and refunds run through `debitUser` / `refundRender` in a single `db.batch` | `apps/api/src/lib/credits.ts` |
| Ledger | `credit_ledger` is append-only, with unique `(render_id, reason)` and `(segmentation_id, reason)` for idempotent refunds and a `plan_amount` column | schema |
| Global fal cap | `reserveBudget` uses an advisory lock, sums the cost of non-failed renders and segmentations plus holds, and inserts a 15-minute hold into `budget_reservations` | `apps/api/src/lib/engine.ts:105` |
| Per-user caps | `resolveLimits` / `checkAllowance`: daily, monthly and concurrent limits, with per-user overrides and `limits_exempt` | `apps/api/src/lib/limits.ts` |
| Feature gating | Studio Control rules apply `enabled`, `allowedPlans` and `rolloutPercent` per feature key, enforced server-side by `checkFeatures` and exposed to the Studio through `/me` | `apps/api/src/lib/studioControl.ts`, `packages/types` |
| Operator permissions | `ROLE_PERMISSIONS` matrix, `denyUnless`, `requireOperator` | `apps/api/src/routes/admin/permissions.ts` |
| Audit | `admin_events`, written alongside each mutation | schema |
| Two-person approval | `approval_requests` with `governance_settings` thresholds | `routes/admin/governance.ts` |
| Storage accounting | `storage_objects` ledger tracks kind and bytes; `storageWouldExceed` against `app_settings.storage_cap_mb` | `apps/api/src/lib/storage.ts` |
| Image processing | `sharp` is already an API dependency | `apps/api/package.json` |
| Tours | Studio guide system: catalog, layer, hotspots and next-step hints. Completion is stored in `localStorage` only | `apps/studio/src/guide/*` |
| Client errors | `/errors/client` deduplicates into incidents (no raw telemetry table) | `apps/api/src/routes/clientErrors.ts` |
| Scheduled work | One daily Vercel cron (`/cron/sweep-renders`), plus a GitHub Actions job calling `/cron/operations-sync` every 5–15 minutes | `apps/api/vercel.json`, `routes/cron.ts` |
| Tests | Vitest against a real local Postgres via a Neon shim; the credit, budget and idempotency suites are the model to follow | `apps/api/test/` |

Constraints the design must respect:

- **No interactive transactions.** The DB client is `drizzle-orm/neon-http`, so atomicity comes from
  `db.batch([...])` (one transaction), single-statement CTEs, check constraints and unique indexes.
  This is the pattern already used for credits.
- **No email provider.** Nothing in the API sends email. See decision D1.
- **The free-plan download lock is client-side only** (`apps/studio/src/canvas/DownloadDialog.tsx`).
  A "downloads unlocked" beta benefit therefore needs a server-provided flag, not just a UI change.
- **The default daily render limit is 5.** Testers on the Free plan would hit it immediately, so
  programs need their own limits (§4.3).
- **Free tiers:** Neon has 1 GB of Postgres; R2 has 10 GB, with `storage_cap_mb` defaulting to 9000.

---

## 2. Principles

1. **A tester is an enrollment, never a role.** `users.role` is not touched. Leaving the program
   changes nothing about plans, subscriptions, purchased credits or projects.
2. **One credit system.** Beta credits are a third bucket inside `credit_balance`, like plan
   credits, and are recorded in `credit_ledger`. There is no second ledger.
3. **Beta credits have a USD ceiling.** A program's fal spend is capped and enforced with the same
   advisory-lock reservation as the global cap. When the cap is reached, new beta-funded jobs
   stop. Projects, feedback and existing downloads keep working. A tester's own credits are used
   only when they explicitly choose them (§4.1).
4. **Reference, don't copy.** Feedback points at existing renders and assets. The only new stored
   file is an optional, compressed screenshot.
5. **The server decides.** Enrollment status, balances, feature grants, mission completion and
   spend are all resolved server-side. The Studio only displays them.

---

## 3. Data model

Migration `0035_beta_program.sql`, all additive. It adds eight tables and a few columns on
existing tables.

### 3.1 New tables

**`beta_programs`** holds one row per program or cohort.

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid pk | |
| slug, name | text | slug unique |
| description | text | tester-facing |
| status | enum `draft, active, paused, ended` | `paused` stops beta spending and new enrollments; testers keep read access |
| starts_at, ends_at | timestamptz | `ends_at` drives credit expiry |
| max_testers | int default 10 | active + suspended enrollments + open invitation slots never exceed it |
| credits_per_tester | int default 25 | granted on enrollment |
| max_credits_per_tester | int default 100 | ceiling on all grants to one enrollment, top-ups included |
| credit_pool | int null | ceiling on all credits granted in the program |
| budget_usd | numeric(10,2) default 10 | hard fal cap for jobs paid with beta credits |
| budget_warning_percent | int default 80 | the admin warning threshold; 100% is always reported |
| daily_render_limit, monthly_render_limit, concurrent_render_limit | int null | override plan limits while enrolled; null keeps the plan's |
| feature_grants | text[] | `StudioFeatureKey`s unlocked regardless of plan (e.g. `export.4k`) |
| downloads_unlocked | bool default true | lifts the free-plan download lock |
| welcome | jsonb | heading, body, benefits[], expectations[] (small and validated) |
| attachment_budget_mb | int default 500 | R2 ceiling for this program's screenshots |
| created_by, created_at, updated_at | | |

**`beta_invitations`**

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid pk | |
| program_id | fk | |
| kind | enum `email, link, existing_user` | |
| email | text null | for `email`: lower-cased, must match the redeemer's Clerk email |
| user_id | fk null | for `existing_user`: binds the invitation to one account |
| token_hash | text unique | SHA-256 of a 32-byte random token; the plaintext is shown once |
| max_redemptions | int default 1 | |
| redemptions | int default 0 | check `redemptions <= max_redemptions` |
| credits_override | int null | replaces `credits_per_tester` for this invitation |
| cohort | text null | label such as "architects" |
| expires_at | timestamptz | |
| revoked_at, revoked_by | | |
| created_by, created_at | | |

**`beta_enrollments`**

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid pk | |
| program_id, user_id | fk | unique `(program_id, user_id)` |
| invitation_id | fk null | |
| status | enum `active, suspended, completed, revoked` | "Invited" is an invitation state, not an enrollment state |
| cohort, profession | text null | |
| credits_granted | int | running total, checked against `max_credits_per_tester` |
| ends_at | timestamptz null | per-tester extension; null = the program's `ends_at` |
| welcome_seen_at, tour_completed_at | timestamptz null | onboarding stored server-side so it works across devices |
| announcements_seen_at | timestamptz null | for the unread badge |
| replies_seen_at | timestamptz null | for the unread-reply badge |
| enrolled_at, ended_at, ended_reason | | |

A partial unique index on `(user_id) WHERE status IN ('active', 'suspended')` allows **one live
enrollment per user**, so `users.beta_credits` always belongs to exactly one enrollment. The same
index serves the per-render lookup.

**`beta_missions`**: `id, program_id, position, title, instructions, rule jsonb, required bool`.
`rule` is one of the following, validated with zod:

```ts
type MissionRule =
  | { kind: "render_succeeded"; jobTypes?: JobType[]; count: number }   // photo|drawing|references|fidelity|edit|edit-references|upscale
  | { kind: "selection_succeeded"; count: number }
  | { kind: "feedback_submitted"; categories?: FeedbackCategory[]; count: number }
  | { kind: "manual" };                                                  // tester ticks it; admin can verify
```

**`beta_mission_progress`**: `enrollment_id, mission_id` (pk), `completed_at`, `verified_by`
(null means automatic), `source` (`auto | tester | admin`). A row exists only once a mission is
complete. There are no per-action rows.

**`beta_feedback`**

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid pk | |
| number | int generated identity | readable "BETA-142" |
| program_id, enrollment_id, user_id | fk | |
| kind | enum `bug, visual_quality, usability, suggestion, praise` | |
| category | enum `architecture_changed, materials_wrong, render_failed, render_stuck, edit_wrong, ui_problem, billing_credits, other` | |
| title | text ≤ 120 | |
| description | text ≤ 4000 | |
| severity_reported | enum `low, medium, high, critical` | from the tester |
| severity | same enum, null | set during triage |
| status | enum `new, triaged, investigating, fix_in_progress, ready_to_verify, resolved, duplicate, expected, cannot_reproduce, declined` | |
| render_id | fk renders, on delete set null | |
| project_id | fk projects, on delete set null | |
| canvas_node_id | text null | |
| annotations | jsonb | see §6.2; capped at 16 KB by a check constraint on `pg_column_size` |
| diagnostics | jsonb | server-built snapshot (§6.3); never user-supplied |
| attachment_key | text null | R2 key; kind `feedback` in `storage_objects` |
| duplicate_of | fk self null | |
| known_issue | bool default false | shown to every tester in the program |
| known_issue_title | text null | tester-safe wording |
| assignee_id | fk users null | |
| github_url | text null | |
| resolved_at | timestamptz null | starts attachment retention |
| created_at, updated_at | | |

Indexes: `(program_id, status, created_at desc)`, `(user_id, created_at desc)`, `(render_id)`.

**`beta_feedback_comments`**: `id, feedback_id, author_id, body ≤ 4000, visibility (tester | internal),
kind (comment | status_change | request_info), detail jsonb, created_at`. Status changes are
written here as `status_change` rows, which keeps one timeline per report without a separate
events table. The table is append-only, with no update or delete routes.

**`beta_announcements`**: `id, program_id, title, body ≤ 2000, severity (info | important),
published_at, expires_at, created_by`.

### 3.2 Changes to existing tables

```sql
-- Third credit bucket, mirroring plan_credits.
ALTER TABLE users ADD COLUMN beta_credits integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN last_beta_debit integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD CONSTRAINT users_beta_credits_within_balance
  CHECK (beta_credits >= 0 AND beta_credits + plan_credits <= credit_balance);
-- (replaces users_plan_credits_within_balance's upper bound)

ALTER TABLE credit_ledger ADD COLUMN beta_amount integer NOT NULL DEFAULT 0;
ALTER TABLE credit_ledger ADD COLUMN beta_enrollment_id uuid REFERENCES beta_enrollments(id);
-- reason enum gains: beta_grant, beta_expiry (text column, TypeScript enum only)
-- beta_grant rows carry period_key = 'beta-grant:<idempotency key>', so the existing
-- credit_ledger_user_reason_period_unique index makes a retried grant a no-op.

ALTER TABLE renders        ADD COLUMN beta_program_id uuid REFERENCES beta_programs(id);
ALTER TABLE segmentations  ADD COLUMN beta_program_id uuid REFERENCES beta_programs(id);
-- A program's hold. The global reserveBudget sums only rows where this is null: the
-- same job's global hold already counts its cost there.
ALTER TABLE budget_reservations ADD COLUMN beta_program_id uuid;
CREATE INDEX renders_beta_program_idx ON renders (beta_program_id) WHERE beta_program_id IS NOT NULL;
CREATE INDEX segmentations_beta_program_idx ON segmentations (beta_program_id) WHERE beta_program_id IS NOT NULL;

-- storage_objects.kind gains 'feedback'; approval_requests.action gains 'beta_grant'.
```

Existing writers changed so they never touch the beta bucket:

- `startFirstPeriod` (`planCredits.ts`) keeps `beta_credits` in addition to permanent credits.
  Without this change, a new account that redeems an invitation before its first credit period
  starts would lose its grant as `promo_expiry`.
- Admin adjustments (`userDetail.ts`) and PayPal refund reversals (`paypalSettlement.ts`) clamp plan
  credits against the non-beta balance, and treat the non-beta part as what can be removed.

### 3.3 Storage estimate

| Item | Size | At 10 testers × 20 reports |
| --- | --- | --- |
| Feedback row + annotations + diagnostics | ~3 KB | ~0.6 MB |
| Comments | ~0.5 KB each | ~0.4 MB at 4 per report |
| Enrollments, invitations, missions, progress, announcements | negligible | < 0.1 MB |
| Screenshots (webp, ≤ 1 MB, typically ~250 KB) | | ~50 MB worst case, capped by `attachment_budget_mb` |

These are estimates, well under 10 MB of Postgres; check them with `pg_total_relation_size`
after the first program. R2 use is bounded by the per-program cap and the global `storage_cap_mb`.

---

## 4. Credits, spend and limits

### 4.1 Funding: beta or account, never silently both

Every charged request from an active tester is **beta-funded** or **account-funded**. Render,
upscale and selection requests accept an optional `funding: "beta" | "account"`.

- **Active tester, `funding` omitted or `"beta"`:** the whole charge comes from `beta_credits`, and
  the job is stamped `beta_program_id`. If the beta credits can't cover it, the request is refused
  with `beta_credits_exhausted` (402). If the program budget can't cover it, the refusal is
  `beta_budget_exhausted` (402). If the program is paused, the tester is suspended, or the program
  is outside its dates, the refusal is `beta_unavailable` (403). **Plan and purchased credits are
  never used as a fallback.**
- **`funding: "account"`:** the existing path runs unchanged (plan credits, then purchased), with no
  program attribution. The Studio sends this only after the tester explicitly chooses "Use my own
  credits" in the refusal dialog.
- **Not an active tester:** `funding` is ignored, except that `"beta"` is refused with
  `beta_unavailable`.
- **Free jobs** (admins, or a price of 0) skip all of this.

A beta-funded debit takes credits only from the beta bucket. `credit_balance` and `beta_credits`
fall together, and the `beta_credits >= 0` check rolls the batch back when the beta credits run
short. That is how `InsufficientBetaCreditsError` is detected, with no constraint-name parsing.

An account-funded debit is today's `debitUser`. The new check
`beta_credits + plan_credits <= credit_balance` means it can never reach into beta credits.

The ledger row records `beta_amount` (`-credits` for beta-funded jobs) and `beta_enrollment_id`.
Refunds return `beta_amount` to `beta_credits`, in the same way plan credits are returned today.

### 4.2 Program budget cap

`reserveProgramBudget(db, programId, costMicros, budgetMicros)` in `lib/beta.ts` mirrors
`reserveBudget`:

- It takes the advisory lock `pg_advisory_xact_lock(88420372, hashtext(program_id))`, a two-key
  form that never collides with the global lock and serializes only one program.
- It sums `cost_micros` of the program's non-failed renders and segmentations
  (`beta_program_id = $1`) plus its live holds in `budget_reservations`, and inserts a hold only if
  the job fits.
- The global `reserveBudget` ignores rows that carry a `beta_program_id`, because the same job's
  global hold already counts its cost.

A beta-funded request takes **both** holds (global first, then program) and releases both in the
existing `finally`. Either refusal stops the job. The program cap therefore can't exceed the global
cap, and raising one never changes the other.

Budget changes and warnings:

- **Warnings.** After each beta-funded job is created, `noteProgramSpend` compares settled spend plus
  holds against `budget_warning_percent` and 100%. It opens (or bumps) an operational incident with
  fingerprint `beta-budget:<program>:<80|100>`, which feeds the existing incident centre and ops
  webhook.
- **Raising the budget** is an admin action (`beta.programs.manage`) with a required reason. It
  writes `admin_events`, and goes through `approval_requests` when the increase is at or above
  the governance money threshold (`refund_approval_threshold_cents`, reused rather than adding a
  column). Nothing increases it automatically. A program is created with at most the $10 authorized
  up front, so every dollar beyond that goes through this audited action.
- **Uncertain jobs.** Pending and processing jobs count at their full budgeted cost until they
  finish or the stuck-job sweep fails them. Failed passes reduce `cost_micros` (existing behaviour).
  A job whose outcome is unknown is never refunded and resubmitted automatically; the existing sweep
  rules apply.

### 4.3 Limits while enrolled

`resolveLimits` takes an optional `beta` argument. For each of the daily, monthly and concurrent
render limits, a non-null program value replaces the plan or global value. A per-user override
still takes precedence, and `limits_exempt` and admins are still exempt. Maintenance pauses, model
holds, the global fal cap and storage caps apply to testers like everyone else. `/me` reports the
resolved values.

### 4.4 Feature grants, exports and downloads

`featureDenial` (`packages/types`) accepts the active program's `feature_grants`. The `"plan"`
denial is skipped for a granted key. `disabled`, model pauses and rollout percentages still apply,
so **an operator kill switch beats a beta grant**. Configuring 4K/8K exports per program means
adding `export.4k` / `export.8k` to `feature_grants`. They are enforced server-side by the existing
`checkFeatures` call in the upscale and render routes.

`downloads_unlocked` is reported in `/me` as `beta.downloadsUnlocked`. **Known gap:** the free-plan
download lock is currently client-side only for *every* user (see §1). A rendered image is viewable
through a signed URL, so stopping its download needs a server-side change to how full-resolution
originals are served to free accounts. That decision is tracked in §13 and is outside the beta
system.

### 4.5 Grants, expiry and graduation

**Grants:** `grantBetaCredits(db, { enrollmentId, amount, actorId, note, idempotencyKey })` is one
batch. It takes the program's advisory lock, then runs a single statement that:

- inserts the `beta_grant` ledger row (`period_key = 'beta-grant:<key>'`, `ON CONFLICT DO NOTHING`)
  only when the enrollment is active, `credits_granted + amount <= max_credits_per_tester`, and the
  program's `credit_pool` (if set) still has room;
- updates `beta_enrollments.credits_granted` and the user's `credit_balance`/`beta_credits` in data-
  modifying CTEs keyed off that insert.

A retry with the same key changes nothing and reports the original grant. Extending dates never
grants credits.

**Expiry:** `expireBetaCredits(db, userId, enrollmentId)` is a single statement:

```sql
WITH u AS (
  UPDATE users SET credit_balance = credit_balance - beta_credits, beta_credits = 0,
                   last_beta_debit = beta_credits
  WHERE id = $1 AND beta_credits > 0 RETURNING id, last_beta_debit)
INSERT INTO credit_ledger (user_id, amount, beta_amount, reason, beta_enrollment_id)
SELECT id, -last_beta_debit, -last_beta_debit, 'beta_expiry', $2 FROM u;
```

The row lock makes it exact under concurrency: a racing second call sees `beta_credits = 0` and
writes nothing. Because a user has at most one live enrollment, the user's whole beta bucket is that
enrollment's.

Expiry runs:

- when an enrollment is completed or revoked;
- lazily on `/me` and `/beta/me`, and in the daily cron, for users with `beta_credits > 0` and no
  live enrollment, or whose live enrollment has passed its effective end date (the enrollment is then
  marked `completed`);
- after any refund that returns beta credits to a user with no live enrollment. A beta-funded render
  that fails after the program ended therefore never leaves credits behind.

**Suspension** freezes beta credits without expiring them. **Graduation** (completion) leaves the
plan, subscription, purchased and plan credits, projects, renders and feedback unchanged.

---

## 5. Invitations and enrollment

### 5.1 Capacity

At 10 testers, capacity is a first-class concept. A program's **occupied slots** are:

```
active + suspended enrollments
+ Σ (max_redemptions − redemptions) over invitations that are not revoked and not expired
```

- Creating an invitation is refused with `program_full` when it would push occupied slots past
  `max_testers`. Expired and revoked invitations release their slots automatically, because the sum
  ignores them.
- Reactivating a suspended tester doesn't change occupancy. Re-enrolling someone after completion
  needs a free slot.
- Every capacity-changing write (invitation create, redemption, reactivation) runs in a batch that
  first takes the program's enrollment lock, `pg_advisory_xact_lock(88420373, hashtext(program_id))`.
  It then checks and writes in one statement. Two simultaneous redemptions of different invitations
  can't create an eleventh tester, and the lock is separate from the budget lock so renders don't
  queue behind enrollment.

The admin header shows `active / pending / free of max_testers`.

### 5.2 Creating invitations (admin)

- **Existing user:** pick an account in admin and choose "Invite to program". This creates an
  `existing_user` invitation bound to that `user_id`. The tester accepts it from a Studio banner
  (`GET /beta/me` reports pending invitations addressed to the caller) or through the link.
- **New person, by email:** this creates an `email` invitation. Where Clerk invitations are
  available, the API calls `clerk.invitations.createInvitation({ emailAddress, redirectUrl:
  <studio>/beta/join?t=<token>, ignoreExisting: false })`, and Clerk sends its invitation email. If
  Clerk reports that the address already has an account, the API finds the matching `users` row and
  issues an `existing_user` invitation instead. A second account is never created for someone who
  already has one. If Clerk isn't available, the admin copies the link.
- **Link:** a shareable link with `max_redemptions` (each redemption slot counts toward capacity)
  and an expiry.

The plaintext token is returned once, in the create response. Only its SHA-256 is stored.

### 5.3 Redemption

`POST /beta/invitations/accept { token }` (authenticated; the account already exists through the
normal Clerk sign-up, so redemption never creates users):

1. Look up the invitation by hash and check that the identity matches: `users.email` equals
   `beta_invitations.email` for `email` invitations (case-insensitive; Clerk verifies the email at
   sign-up), and `user_id` matches for `existing_user`.
2. In one batch: take the enrollment lock, then run one statement that inserts the enrollment only
   when the invitation is still open (not revoked, not expired, `redemptions < max_redemptions`), the
   program is active and inside its dates, and the user has no live enrollment. Data-modifying CTEs
   keyed off that insert increment `redemptions`. Because a pending invitation already holds its
   slot, redeeming it doesn't change occupancy, so no other capacity check is needed. For a link
   invitation, the occupancy check is still applied in the same statement.
3. Grant `credits_override ?? credits_per_tester` through `grantBetaCredits`, with idempotency key
   `enroll:<enrollmentId>`.
4. Return the enrollment. The Studio then routes to the welcome modal.

Errors are specific and safe to show: `invite_expired`, `invite_used`, `invite_revoked`,
`invite_wrong_account` (which shows the invited address masked as `a•••@example.com`),
`program_full`, `program_closed`, `already_enrolled` (a retry of an accepted invitation returns the
enrollment).

Signed-out visitors are sent through the normal sign-up or login flow, with the token kept in
`sessionStorage` (`authRoutes.ts` / `finishAuth.ts`), and land back on `/beta/join`.

### 5.4 Lifecycle

```
Invitation:  pending → redeemed | expired | revoked
Enrollment:  active ⇄ suspended → completed | revoked
```

- **Suspend** stops beta spending and feature grants, keeps beta credits frozen, keeps the slot, and
  keeps read access to the tester's own reports.
- **Reactivate** returns a suspended tester to active.
- **Revoke** or **complete** expires beta credits (§4.5) and frees the slot.
- **Extend:** moving one tester's end date sets `beta_enrollments.ends_at`; moving everyone's sets
  `beta_programs.ends_at`. Neither changes credits or budget.

Every admin transition writes `admin_events` (`beta.enrollment.suspend`, and so on).

---

## 6. Feedback

### 6.1 Entry points in the Studio

- **"Report this render"** in the results panel's actions for the active job
  (`shell/panel/RenderResultsPanel.tsx`), plus a failed-render variant on the error card.
- **The Beta Program button** in the canvas top bar (`shell/CanvasTopBar.tsx`), visible only to active
  testers, with "Report a problem" and "Suggest something".
- **The dashboard tester portal** (§7.3), for general reports with no render attached.

All of these open one `FeedbackDrawer` (new: `apps/studio/src/beta/feedback/`). It has its own
small Zustand store. Nothing goes into `GenerateBar` or the render stores; the drawer reads the
active job id through an existing selector.

### 6.2 Annotation on the canvas

When a render is attached, the drawer puts the canvas into an **annotate mode**, an overlay above
`RenderPreview` that reuses `usePanZoom` / `useFittedBox` for the transform:

- **Pin:** click to drop a numbered pin, with an optional short label (≤ 140 chars). Up to 10 pins.
- **Box:** drag a rectangle. Up to 5.
- **Freehand:** a stroke simplified client-side (Ramer–Douglas–Peucker) to ≤ 64 points. Up to 5.

All coordinates are normalized to the image (0–1, 3 decimal places), so they survive any zoom or pan:

```json
{
  "v": 1,
  "image": "result",
  "pins":  [{ "x": 0.624, "y": 0.318, "label": "Roof pitch changed" }],
  "boxes": [{ "x": 0.41, "y": 0.12, "w": 0.30, "h": 0.22 }],
  "strokes": [{ "points": [[0.1, 0.2], [0.12, 0.25]] }]
}
```

`image` is `"result"` or `"source"`, because a fidelity complaint may need marks on the source too.
The schema is validated with zod on the server, and the 16 KB column check is the backstop.

Admin replays the annotations by drawing the same overlay on the render's existing signed URL,
together with a source/result comparison slider. No image is copied.

### 6.3 Diagnostics snapshot (server-built)

On submit, the client sends only `renderId`, `projectId`, `canvasNodeId`, `appVersion` (the build SHA
injected through Vite `define`) and the last `X-Request-Id` it saw for that render, if any. The
server checks that the render belongs to the caller and then copies the following from its own
records into `diagnostics`:

```json
{
  "render": { "status": "failed", "jobType": "fidelity", "model": "…", "outputResolution": null,
              "configVersion": 41, "creditsCharged": 2, "costMicros": 40000,
              "errorMessage": "…sanitized…", "createdAt": "…", "durationMs": 34120 },
  "events": [{ "type": "submitted", "at": "…" }, { "type": "failed", "at": "…" }],
  "client": { "appVersion": "d456517", "userAgent": "Chrome 141 / Windows", "viewport": "1920x1080" },
  "requestId": "…"
}
```

`events` is the existing `render_job_events` for that render, truncated to 20. Prompts and settings
are **not** copied: admins with `renders.read` open the linked render as they do today. Signed URLs,
fal request ids and keys are never included.

If the render is deleted later, `render_id` becomes null and the snapshot stays, so the report
remains readable.

### 6.4 Screenshot attachment

There is one optional image per report, plus one per tester reply.

`POST /beta/feedback/:id/attachment` (multipart, ≤ 5 MB in) is re-encoded with `sharp` to WebP, with
a 2048 px maximum edge and a size of ≤ 1 MB. The upload is refused if it can't be encoded under
that limit. It is written with `putObject` under `feedback/<programId>/<feedbackId>.webp`
(`storage_objects.kind = 'feedback'`).

The upload is refused, while text feedback still works, when:

- the program's `attachment_budget_mb` would be exceeded (sum of `storage_objects` where the key
  starts with `feedback/<programId>/`);
- the global `storageWouldExceed` check fails;
- the tester already has 20 attachments in the program.

Attachments are private and served through the existing signed-URL path (`presentUploadUrl`).

**Retention:** the daily cron deletes attachments of feedback resolved more than 90 days ago, along
with their `storage_objects` rows. Reports and comments are kept.

### 6.5 Known-issue matching

Before submitting, the drawer calls `GET /beta/known-issues?category=…` and shows the program's
`known_issue = true` reports in that category. "This is my problem" adds a `+1` comment to that report
instead of creating a new one. It is a plain category filter with no search infrastructure.

### 6.6 Triage (admin)

The report detail shows the annotated render, the comparison slider, the diagnostics, the tester's
other reports and a timeline of comments and status changes. Available actions:

- set status, severity and assignee;
- mark as a duplicate of another report (the tester is notified and the original gets a `+1`);
- toggle known issue and edit the tester-safe title;
- add a GitHub URL;
- write an **internal note** or a **reply to the tester**;
- **Request info**, which sets status to `investigating` and adds a `request_info` comment, shown to
  the tester as a highlighted question;
- **Mark fixed**, which moves the report to `ready_to_verify`. The tester sees "Fixed — can you check?"
  and can confirm (→ `resolved`) or reopen (→ `triaged`, with their comment).

---

## 7. Tester experience (Studio)

All new Studio code lives under `apps/studio/src/beta/`, with one store, `useBetaStore`, filled from
`GET /beta/me`. It is fetched once alongside `/me`, and refetched after feedback, mission or
announcement actions.

### 7.1 Welcome modal

It is shown when `enrollment.welcome_seen_at` is null. It contains the program name, the tester's
credit grant, the program end date, the benefits list (from `welcome.benefits`, with feature grants
named from `STUDIO_FEATURES` labels), expectations, a privacy note (§9), and buttons for "Start the
tour" and "Later". Dismissing it calls `POST /beta/me/welcome-seen`. It can be reopened from the
Beta Program menu.

### 7.2 Guided tour

This extends the existing guide system rather than adding a tour library. A `beta-orientation` tour
is added to `guide/catalog.ts`, targeting existing anchors (uploads, generate, results panel, edit
tabs) plus one new anchor on the Beta Program button for "Report issues here". Completion calls
`POST /beta/me/tour-complete`, in addition to the existing `localStorage` write, so it carries
across devices.

### 7.3 Tester portal

This is a new dashboard section, `beta`, in `DashboardSidebar`, shown only to testers. It contains:

- **Overview:** beta credits left out of those granted, days remaining, program status, and the
  next incomplete mission.
- **Missions:** a checklist. Automatic missions show "Verified when you…" and the count so far;
  manual ones have a "Mark done" action.
- **My reports:** a list with status chips and unread-reply dots. Each report opens the thread and
  the confirm-fix action.
- **Known issues and announcements.**

The canvas top-bar **Beta Program** button shows a badge that combines unread replies and unread
announcements, and a menu linking to the portal sections, the report drawer and "Replay welcome".

### 7.4 Mission verification

`GET /beta/me` evaluates incomplete automatic missions with count queries over existing tables,
limited to `created_at >= enrolled_at` for that user:

- `render_succeeded`: renders joined to projects where owner = user, status `succeeded`, optional
  `job_type IN (…)`;
- `selection_succeeded`: segmentations with `object_count > 0`;
- `feedback_submitted`: rows in `beta_feedback`.

Missions that are now satisfied get a `beta_mission_progress` row (insert on conflict do nothing).
This costs at most one aggregate query per incomplete mission per `/beta/me` call, and needs no event
stream.

### 7.5 Notifications

Notifications are in-app only: badges computed from `replies_seen_at` and `announcements_seen_at`.
Email notification for replies depends on D1, and is skipped if D1 isn't resolved.

---

## 8. Admin: Beta Management

There is one new nav entry, **Beta Program**, in `admin/src/lib/nav.ts`, with these routes:

| Route | Contents |
| --- | --- |
| `/beta` | Program overview: active testers, pending invitations, open reports by severity, beta spend against budget (bar), credits granted vs spent, mission completion, and a recent-reports list |
| `/beta/programs/:id` | Settings for dates, caps, budget, limits, feature grants, welcome copy, missions (ordered list editor) and announcements, plus pause, resume and end controls |
| `/beta/testers` | Paginated enrollments with filters for status and cohort; actions for grant credits, suspend, resume, revoke and complete, plus CSV export |
| `/beta/invitations` | Create (single, bulk CSV, link), list, revoke, copy link |
| `/beta/feedback` | Inbox with filters for status, severity, category, assignee, program and known issue; detail view as in §6.6 |
| `/beta/analytics` | Charts reusing `DailyChart`: enrollments over time, beta spend per day, reports per day by category, median time to triage and to resolve, render failure rate for testers vs everyone, and fidelity complaints per 100 tester renders |

The **user detail page** (`UserDetailPage.tsx`) gains a "Beta" panel showing enrollment status,
credits, reports and an invite action. The **credit ledger page** labels `beta_grant` and
`beta_expiry` rows.

All analytics are aggregates over `renders` / `segmentations` (`beta_program_id`, or owner ∈
testers), `credit_ledger`, `beta_feedback` and `beta_mission_progress`, using paginated and
date-bounded queries only.

---

## 9. Permissions, privacy, audit

New permissions in `permissions.ts`:

| Permission | analyst | support | billing | admin |
| --- | :-: | :-: | :-: | :-: |
| `beta.read` (overview, testers, analytics) | ✓ | ✓ | ✓ | ✓ |
| `beta.feedback.manage` (triage, reply, known issues) | | ✓ | | ✓ |
| `beta.testers.manage` (invite, suspend, revoke, complete) | | ✓ | | ✓ |
| `beta.credits.manage` (grant beyond the invitation amount) | | | ✓ | ✓ |
| `beta.programs.manage` (create and configure, budgets, end) | | | | ✓ |

- A credit grant that takes a tester over `governance_settings.bulk_credit_approval_threshold`, or
  any bulk grant to more than one tester, goes through `approval_requests` (new action
  `beta_grant`).
- A budget increase on an active program also needs approval when it exceeds the threshold.
- Every mutation writes `admin_events` with `targetType: "beta_*"`.
- Testers can read only their own enrollment, feedback, comments with `visibility = 'tester'`,
  their program's known issues, announcements and missions. Every `/beta/*` query filters by the
  caller's `user_id` on the server.
- **Privacy note** (welcome modal and portal): "When you send a report, we save what you wrote,
  your marks on the image, any screenshot you attach, and technical details of the render you
  reported (model, timings, error). We don't record your screen or track your activity. Screenshots
  are deleted 90 days after the report is resolved."

---

## 10. API surface

The routes follow the existing structure, with no `/v1` prefix. Tester routes go in
`apps/api/src/routes/beta.ts` and admin routes in `apps/api/src/routes/admin/beta*.ts`.

Tester (`requireAuth`):

```
GET    /beta/me                       enrollment, program, credits, missions(+progress), unread counts, announcements
POST   /beta/me/welcome-seen
POST   /beta/me/tour-complete
POST   /beta/me/announcements-seen
POST   /beta/invitations/accept       { token }
GET    /beta/invitations/preview?t=   program name, inviter-safe info, validity (no auth required; rate-limited by token hash)
POST   /beta/missions/:id/complete    manual missions only
GET    /beta/known-issues?category=
GET    /beta/feedback                 own, paginated
POST   /beta/feedback                 { kind, category, title, description, severity, renderId?, projectId?, canvasNodeId?, annotations?, appVersion?, requestId? }
GET    /beta/feedback/:id             own only; tester-visible comments
POST   /beta/feedback/:id/comments    { body }
POST   /beta/feedback/:id/attachment  multipart
POST   /beta/feedback/:id/confirm-fix { fixed: boolean, comment? }
POST   /beta/feedback/:id/plus-one
```

Admin (`requireOperator` and `denyUnless`):

```
GET/POST        /admin/beta/programs           PATCH /admin/beta/programs/:id   POST …/:id/{pause,resume,end}
GET/POST        /admin/beta/programs/:id/missions        PATCH/DELETE …/missions/:mid
GET/POST        /admin/beta/programs/:id/announcements   DELETE …/:aid
GET/POST        /admin/beta/invitations        POST /admin/beta/invitations/bulk   POST …/:id/revoke
GET             /admin/beta/enrollments        POST …/:id/{suspend,resume,revoke,complete,grant}
GET             /admin/beta/enrollments.csv
GET             /admin/beta/feedback           GET/PATCH /admin/beta/feedback/:id
POST            /admin/beta/feedback/:id/comments   POST …/:id/duplicate   POST …/:id/request-info
GET             /admin/beta/overview           GET /admin/beta/analytics?programId&from&to
```

Shared response and request types go in `packages/types`.

---

## 11. Build order

Each stage ends with tests passing and is committed on its own. The whole system ships together
(§12).

1. **Schema and credits core.** Migration 0035, the beta bucket in `debitUser` and the refunds,
   `reserveProgramBudget`, `expireBetaCredits`, and the limits and feature-grant hooks.
   *Tests first:* beta-only debits, no fallback to account credits, explicit account funding,
   partial beta refunds, the program cap under concurrent submissions with global-cap precedence,
   budget warnings, grant limits and idempotency, expiry (including refunds after expiry), the
   first-period fix, and the `beta_credits + plan_credits <= credit_balance` invariant across
   every existing writer.
2. **Programs, invitations, enrollment.** Admin program CRUD, the three invitation kinds,
   redemption, lifecycle actions, permissions and audit.
   *Tests:* token hashing, expiry, max redemptions under concurrent accepts, email mismatch,
   `program_full`, idempotent re-accept, and that an existing customer's plan, credits and role are
   unchanged.
3. **Tester onboarding.** `/beta/me`, the join route, welcome modal, beta tour, portal shell,
   missions and verification, and announcements.
4. **Feedback.** Drawer, annotate overlay, diagnostics builder, attachments with compression and
   caps, known-issue matching, threads and confirm-fix.
5. **Admin Beta Management.** Overview, testers, invitations, inbox and triage, analytics, the user
   detail panel and ledger labels.
6. **Housekeeping.** Cron expiry and attachment retention, plus the storage-usage line for
   `feedback` in the admin storage section (`settings/StorageSection.tsx`).
7. **Hardening.** Playwright end-to-end tests (`apps/studio/e2e`) covering admin invite → sign up →
   welcome → tour → render → report with pin → admin reply → tester confirms. Also test suspend
   mid-session, program end, and budget exhaustion against the mock engine.

## 12. Release gate

Do not send real invitations until all of the following are true:

- every stage's tests pass, with `pnpm typecheck` and `pnpm lint` clean;
- the e2e run passes against `FAL_MODE=mock`;
- one internal program has been run with two staff accounts on production (one new, one existing
  customer), confirming the existing customer's ledger, plan and role are unchanged afterwards;
- migration 0035 has been applied to production (`pnpm db:migrate`) before the code that reads it
  is deployed.

---

## 13. Decisions

Resolved on 2026-10-15:

- **D1. Invitation email:** Clerk invitations for new addresses, with a copyable link as the fallback
  and in-app acceptance for existing users. There is no custom email provider.
- **D2. Spend order:** beta-funded jobs use beta credits only, and account credits are used only on
  the tester's explicit choice (§4.1).
- **D3. Defaults:** 10 testers, 25 credits, 21 days (14–21), a 0 budget with warnings at 80% and
  100%, and manual increases only (header table).
- **D4. Extensions:** per tester (`beta_enrollments.ends_at`) and for the whole program.
- **D5. Downloads:** on by default when the program enables them. 4K/8K exports are configured per
  program.

Still open:

- **D6. Server-side download enforcement.** The free-plan download lock is client-side only for all
  users (§4.4). Enforcing it on the server, for example by serving free accounts a watermarked or
  reduced-size display copy and the original only through an authorized download endpoint, is a
  change to the core product, not the beta system. It needs its own decision.
- **D7. Published credit prices.** Check the live Studio Control revision's prices before the
  program starts. The cost table above uses Settings' defaults.
