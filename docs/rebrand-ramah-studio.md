# Rebrand: Renvia to RAMAH STUDIO INTERNATIONAL (October 2026)

Renvia was the product's development name. In October 2026 the product took its official identity, **RAMAH STUDIO INTERNATIONAL**. This document records what changed, the decisions behind it, how it was verified, and what is left to do. The brand system itself (names, logo, colours, how to change them) is described in [branding.md](branding.md).

## Summary

- **Live since 2026-10-20.** The website, Studio and admin show the Ramah Studio name and logo, and serve from Ramah Studio addresses.
- **Free-plan renders carry the new watermark** (version 3). The watermark's layout is unchanged; only its artwork changed.
- **Nothing customers rely on broke:** existing images, sign-in, payments, invitations and stored preferences keep working, and the old addresses still serve.
- **A few manual steps remain** in third-party dashboards and admin data; see [Outstanding actions](#outstanding-actions).

## Commits

| Commit | What it did |
| --- | --- |
| `54f5d49` | Storage accounting: versioned watermark copies are counted as watermarks, not uploads |
| `24b6af9` | The rebrand: brand package, reconstructed logo, new wording, watermark version 3 |
| `c4ccb90` | Repaired five API tests that had failed in CI since 15 October |
| `3ad6be5` | Script to clean up copies from earlier watermark designs |
| `d187fd3` | Ops guide updated with the new Vercel projects, addresses and variables |
| `5d46cf7` | Unsplash photo search removed from the Studio |

## What changed

### Identity and logo

- A shared package, `packages/brand` (`@renvia/brand`), now holds the names, colours and all logo artwork. See [branding.md](branding.md#the-brand-package).
- The owner's logo was supplied only as a flattened PNG, and no open-licence font matched its lettering, so it was **reconstructed as vectors from the image** with 97–99.7% overlap and about 0.1 px mean edge error. See [branding.md](branding.md#where-the-artwork-comes-from).
- Variants: the wordmark (RAMAH STUDIO over a smaller italic *international*), the official logo (symbol above wordmark), the RS symbol, an app icon, and a watermark cut. Light and dark versions of each.
- The three apps' `Logo` components draw from the shared artwork. The old RENVIA wordmark and the blue "R" favicon are gone.
- The Studio dashboard sidebar shows the RS symbol when it collapses, instead of a cropped wordmark.

### Marketing website

- Page title "Ramah Studio International — AI Architectural Visualization"; Open Graph site name and application name set; blog titles end "— Ramah Studio".
- Navbar shows the RS app icon and the wordmark; the "Visual intelligence" tagline was removed.
- All section copy, the FAQ, alt text and accessible labels say Ramah Studio; the footer reads "© 2026 Ramah Studio International. All rights reserved."
- New: a web app manifest (name, short name, theme colour, 192 and 512 px icons) and a `NEXT_PUBLIC_SITE_URL`, so link previews point at the real site instead of `localhost:3000`.

### Studio

- Title "Ramah Studio"; sign-in reads "Welcome back to Ramah Studio."; sign-up "Start rendering with Ramah Studio."
- Every customer-facing message that named Renvia (errors, connection banners, storage-full notices, beta screens, account menu, guide, help) now says Ramah Studio.
- Downloads are named `ramah-studio-…` instead of `renvia-…`.
- The beta invitation banner picture, which had the old RENVIA watermark baked in, was replaced with a clean render; an unused screenshot with the old name was deleted.
- **Unsplash photo search was removed** (see [Unsplash removal](#unsplash-removal)).

### Admin

- Title, sidebar, headers and error screen say "Ramah Studio Admin"; beta program defaults and help text updated.
- Audit exports are named `ramah-studio-audit-<id>.csv`.

### API

- PayPal subscription cancellations are sent with the reason "Cancelled in Ramah Studio".
- The image importer identifies itself as `RamahStudioBot/1.0` (no URL; there is no verified domain yet).
- The beta feedback "working as intended" reply says Ramah Studio.
- Internal payment-settlement error messages were deliberately left unchanged: they are staff-only and also stored in historical rows.

## Watermark

The watermark kept its exact layout: grid, dashed crosses, 45% and 50% opacity, white, scaling and image processing. Only the artwork in each tile changed, from "R RENVIA" to the RS symbol with RAMAH STUDIO over *international*. Full details are in [watermark-design.md](watermark-design.md).

- **Version 3.** Every free-plan image gets a fresh copy with the new mark the first time it is viewed. Clean originals are never modified.
- **Thumbnails are now versioned too**, so old RENVIA thumbnails are never reused.
- **Deleting a project** now removes every stored watermark version, not only the current one.
- **The artwork is a slightly bolder cut** of the logo, baked into the shapes so thin serifs stay visible at watermark size without slowing processing: an 8K image takes about 2.6 s instead of 1.8 s, once, with the same memory.
- Tests pin the grid to the previous design, so artwork changes cannot move it.

**Went live 2026-10-20 at 06:54 UTC** (first version 3 copy stored).

### Cleaning up the old copies

Old copies are no longer served but stay in storage until removed. A dry run against production on 2026-10-20 found **36 version 2 copies (13.5 MB) and 23 old thumbnails (0.8 MB)**. They are safe to delete **from 2026-10-28**: a browser can hold a cached link to an old copy for up to 7 days. From `apps/api`:

```bash
node --env-file=.env.local scripts/cleanup-watermarks.ts                     # preview: counts, sizes, examples
node --env-file=.env.local scripts/cleanup-watermarks.ts --reclassify        # fix storage accounting only
node --env-file=.env.local scripts/cleanup-watermarks.ts --apply --confirm <count from preview>
```

The script can only ever match old watermark copies and their thumbnails, refuses to delete before the grace period has passed, and needs the exact count from the preview. See [watermark-design.md](watermark-design.md#cleaning-up-older-versions).

## Hosting (Vercel)

The three customer-facing projects were renamed and given Ramah Studio addresses. The old addresses still serve, so existing links and beta invitations keep working.

| App | Vercel project | Address | Old address (still serves) |
| --- | --- | --- | --- |
| Website | `ramah-studio` (was `renvia-marketing`) | https://ramah-studio.vercel.app | renvia.vercel.app |
| Studio | `ramah-studio-app` (was `renvia-studio`) | https://ramah-studio-app.vercel.app | renvia-studio.vercel.app |
| Admin | `ramah-studio-admin` (was `renvia-admin`) | https://ramah-studio-admin.vercel.app | renvia-admin.vercel.app |
| API | `renvia-api` (unchanged) | https://renvia-api.vercel.app (unchanged) | — |

**The API keeps its address on purpose.** Every stored image URL contains `renvia-api.vercel.app`, and the API only serves URLs with its own address; moving it would break every existing render and upload. Customers never see it.

Renaming a Vercel project does not change its environment variables. These were changed because the addresses changed:

| Project | Variable | New value |
| --- | --- | --- |
| API | `STUDIO_URL` | `https://ramah-studio-app.vercel.app` (new invitation links) |
| API | `ALLOWED_ORIGINS` | Old and new Studio and admin addresses, plus localhost |
| Studio | `VITE_MARKETING_URL` | `https://ramah-studio.vercel.app` |
| Website | `NEXT_PUBLIC_STUDIO_URL` | `https://ramah-studio-app.vercel.app` |
| Website | `NEXT_PUBLIC_SITE_URL` | `https://ramah-studio.vercel.app` (new) |
| Studio | `VITE_UNSPLASH_ACCESS_KEY` | Removed |

`ALLOWED_ORIGINS` had a stray preview-only duplicate that blocked edits and a legacy setting that could not be changed in place; the duplicate was deleted and the variable recreated for production, preview and development. The API, Studio and website were redeployed. The current values are also listed in [beta-operations.md](beta-operations.md#2-infrastructure).

## Unsplash removal

The Studio no longer searches Unsplash for reference images. References come from uploads, the library (including the team's samples) and links.

- Removed: the Unsplash button and search window, the Unsplash client, the Assets page tab and badge, the guide mention, and styles only that window used.
- `"unsplash"` is no longer an accepted reference source in the API or shared types. No stored reference used it (production had 63 uploads and 22 links), and the column has no database constraint, so no migration was needed.
- The `VITE_UNSPLASH_ACCESS_KEY` variable is removed everywhere. Because Vite includes every `VITE_` variable in the Studio's public JavaScript, the key had been readable by anyone using the Studio.

## Other fixes made along the way

- **Storage accounting:** stored watermark copies were recorded as "uploads" on the admin storage page. New copies are now counted correctly; the 36 existing rows are corrected by `--reclassify` or removed by the cleanup.
- **CI is green again.** It had failed since 15 October: two admin snapshots missed newer routes and storage kinds, and three storage tests and the watermark test had not been updated for image compression and redirect-based serving. All were updated; no code bug was involved.

## How it was verified

- Type check, lint (two pre-existing warnings), all builds, and all unit and API tests, in CI on GitHub.
- The built website, Studio and admin were searched for any visible "Renvia" text; none remains.
- Every image the apps serve was checked by eye for baked-in branding.
- In production: all old and new addresses load; the API accepts the new and old Studio and admin addresses and rejects others; the website links to the new Studio and back; the Studio and admin sign-in screens load on the new addresses without errors; the watermark serves version 3.
- The logo reconstruction was compared pixel by pixel against the owner's image, and reviewed on a sign-off sheet ([images/branding-signoff-sheet.jpg](images/branding-signoff-sheet.jpg)).

## Outstanding actions

| # | Action | Where | Who | What customers see until then |
| --- | --- | --- | --- | --- |
| 1 | Owner approves the reconstructed logo (sign-off sheet) | — | Owner | Nothing; the logo is already live |
| 2 | Replace the Studio screenshot on the website and in the README | `apps/marketing/public/studio/renvia-studio-showcase.webp`, `docs/images/studio-hero.png` | Needs a signed-in account with real projects | The screenshot shows "Renvia Studio" and the removed Unsplash button |
| 3 | Rename the application in Clerk | Clerk dashboard | Account owner | Admin sign-in says "Sign in to Renvia"; Clerk emails say Renvia |
| 4 | Update business and plan names in PayPal and Paystack | PayPal and Paystack dashboards | Account owner | Receipts and checkout may show the old name |
| 5 | Update text stored in the database | Admin: Plans (Free plan description), Beta programs (names) | Admin user | Free plan says "Try Renvia with monthly credits…"; old beta program names |
| 6 | Clean up old watermark copies | `scripts/cleanup-watermarks.ts` | Developer, from 2026-10-28 | Nothing (14.3 MB of storage) |
| 7 | Decide on the old addresses | Vercel | Developer | Old addresses still serve the apps unchanged |
| 8 | Remove unused secrets from the website project | Vercel, project `ramah-studio` | Developer | Nothing; a security tidy-up |

### Dashboard checklist

**Clerk** (needs Clerk dashboard access)
- Application name: Renvia → Ramah Studio International. Changes "Sign in to Renvia" in the admin and the sender name of invitation and verification emails.
- Email templates and logo: replace any Renvia wording and upload the app icon (`packages/brand/assets/icon-512.png`).
- The instance is still in development mode (`pk_test`, "Development mode" badge). For launch, create a production instance on the client's own domain; that needs the domain's DNS and new keys in the Studio, admin and API projects.
- Verify: open https://ramah-studio-admin.vercel.app and send yourself a beta invitation.

**PayPal** (needs the business account)
- Business display name, and the names of the products and subscription plans the app's plan IDs point to.
- Verify: start a sandbox checkout and check the name on the approval page and receipt.
- Risk: changing plan *names* is safe; do not recreate plans, because the app stores their IDs.

**Paystack** (needs the business account)
- Business name and checkout branding; plan names.
- Verify: a test charge's checkout page and receipt.

**Old addresses** (Vercel)
- Optional: make renvia.vercel.app, renvia-studio.vercel.app and renvia-admin.vercel.app redirect to the new addresses. People signed in on the old Studio address would sign in once more on the new one. Keep the old addresses in `ALLOWED_ORIGINS` until traffic has moved.

## What still says "renvia", and why

After the rebrand, "renvia" remains only in internal identifiers that customers never see: package names, the API address, the storage bucket and keys, browser storage keys, GitHub secret names, database migrations and test fixtures, staff-only error messages, and image file names. The full list with reasons is in [branding.md](branding.md#what-still-says-renvia-on-purpose).
