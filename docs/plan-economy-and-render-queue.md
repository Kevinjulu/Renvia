# Plan economy, the render queue and smart edits

Built 2026-10-21. Covers migration `0045_plan_economy`, the render queue in the Generate bar, the
`render.multiElevation` Studio Control feature, edits being exempt from daily and monthly limits,
and the Edit tab's guided Apply button and tour.

## Why

Admins could render all four elevations in one Generate; everyone else only got the first. Nothing
was broken in the Generate code. The plan's concurrent-render cap (1 on Free, 3 on Pro) refused every
request after the first, and the refusal was easy to miss. Admins are exempt from that cap, which is
why it looked fine from the admin account.

## The economy

One place states the launch terms: `PLAN_ECONOMY` in `packages/types/src/index.ts`. The **database
is what the app enforces and the admin edits**; `PLAN_ECONOMY` is the reference that migrations,
marketing copy and tests are checked against (`apps/api/test/planEconomy.test.ts`).

| | Free (`starter`) | Pro (`studio`) | Premium (`team`) |
| --- | --- | --- | --- |
| Monthly credits | 20 | 300 | 1,000 |
| Renders per day | **10** (was 5) | 60 | 250 |
| Renders per month | 25 | none | none |
| Renders at once | **4** (was 1) | **6** (was 3) | 8 |
| Projects | 2 | 50 | 500 |

Rules:

- **Credits** are charged per image (renders, edits, upscales) and are the only limit on edits.
- **Edits do not count toward the daily or monthly render limits.** They still count as in flight, so
  an edit waits for a free slot when the plan's renders-at-once cap is full. Implemented by
  `Kind = "edit"` in `lib/limits.ts` and by excluding `job_type in ('edit','edit-references')` from
  the day and month counts in both `getUsage` and the in-transaction check in `lib/credits.ts`.
- Free's 25-render monthly limit sits above its 20 credits on purpose: it is headroom for purchased
  packs, never the binding limit on its own credits.
- Every plan can render a project's four default elevations at once (`>= 4` renders at once).

### Changing a number

Edit the plan in **Admin → Plans & Pricing**. That writes a new `billing_plan_versions` row, so the
history explains the change. If you change a launch number, also change `PLAN_ECONOMY`, the
marketing pricing page and FAQ; `planEconomy.test.ts` fails until they agree.

### Migration 0045

Moves each plan only if it is still on its previous launch value, so a figure an operator has since
set is left alone, and writes a plan version for every plan it changes. It also moves
`app_settings.daily_render_limit` (the fallback when a plan has none) from 5 to 10. It is safe to run
twice. The test caught one real bug while this was built: the version snapshot has to be built from
the `UPDATE ... RETURNING` rows, because a sibling statement of the same query still sees the plan as
it was before the update.

Migration `0046_drop_signup_bonus_credits` removes `app_settings.signup_bonus_credits`. Nothing read it
(Free credits are the Free plan's monthly allowance), and its default of 25 contradicted the 20 credits
customers actually get. The `signup_bonus` ledger reason stays, because it labels historical rows.

## The render queue

`apps/studio/src/canvas/utils/runThrottled.ts` (pure, unit-tested) sends a Generate's renders without
exceeding the plan's concurrent cap. The rest wait in line and start as running renders finish.
Nothing is sent, or charged, until its turn.

- The cap comes from `/me` (`limits.concurrentRenders`; `null` for admins means no queue).
- A `concurrency_limit_reached` or `rate_limited` refusal puts the request back in line (covers
  another tab or project using the slots). Credits, daily and monthly limits, maintenance, budget
  and feature refusals stop the line and drop what has not been sent.
- The Generate bar shows `Rendering 2 of 4`, a progress bar, a note that the next one starts when a
  render finishes, and a **Stop** button. Leaving the project stops the line too.
- Waiting does not lock the Edit tab: the batch lives in `useGenerateBatchStore`, separate from the
  edit's own submitting state.

`apps/api/test/generateQueue.test.ts` drives the real route: four elevations on a plan that runs two at
once all render, never more than two at a time, and the same Generate without the queue on a
one-at-a-time plan reproduces the original bug (only the first render goes through).

## Multi-elevation as a plan feature

`render.multiElevation` is a Studio Control feature (group **Render**). The Studio marks every request
of a Generate that covers more than one elevation with `generationSettings.multiElevation`. By default
it is on for every plan. To make it paid-only, open **Admin → Studio Control**, edit
*Multi-elevation render* and choose the plans that get it. A plan without it sees **Upgrade to use** on
the Generate button, an upgrade popup, and a note that it can switch elevations off to render one at a
time.

This is a plan convenience gate, not a security boundary: someone can still render elevations one at a
time. The cap, credits and budgets are what protect cost.

## Edits: smart Apply button and tour

- Apply edit is now always pressable in the Edit tab. Pressed without what it needs, it says what to
  do ("Write a prompt describing the change…") and points at the missing control: scrolls to it, focuses
  it and flashes it. `editRequestNeed` in `packages/types` returns both the `need` and the message;
  `editRequestProblem` (also used by the API) is derived from it so the Studio and the API always say
  the same thing.
- "Describe" is now "Prompt" throughout the Edit tab, help articles and error messages.
- **How to make a good edit** (Guide menu) starts a seven-step Edit tour: how to edit, the prompt,
  whole image or one area, the selection tools, light and weather, Apply. A one-time offer at the top
  of the Edit panel invites new users to take it; taking, skipping or dismissing it counts as seen.

## Tests

`apps/api`: `editLimits`, `planEconomy`, `generateQueue`, plus multi-elevation cases in
`studioControl`. `apps/studio`: `runThrottled.test.mjs`. `packages/types`: `editRequestNeed.test.mjs`.
