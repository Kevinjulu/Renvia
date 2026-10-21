# Samples

Samples are images the Ramah Studio team uploads for every user. They replaced the sample tabs that
used to sit inside the reference **Library**, and added a second kind: original designs a new user can
start a project from. A brand-new account with no images of its own has everything it needs to render.

## What users see

The Reference images section of the Render tab has four actions:

| Action | What it does |
| --- | --- |
| **Upload** | A file from the computer, saved to the user's library. |
| **Library** | The images the user has saved before (their own, nothing from the team). |
| **Browse** | Pinterest / Google Images, plus pasting an image or page link. |
| **Samples** | The team's images, in a popup. See below. |

**Samples** has two sections, shown only when they have images:

- **References**: Windows, Roof, Doors, Pillars, Outdoors, Exterior. Clicking one attaches it to the
  render as a reference (by link, nothing is copied).
- **Designs**: 3D model (ArchiCAD or similar), Photo, Drawing. Clicking one makes it the user's
  elevation.

Sample designs are also offered where a new user would look first:

- an empty elevation card: "or start from a sample design";
- the empty canvas: "No design yet? Start from a sample".

A design goes to the active elevation if it is empty, otherwise the first empty one, otherwise a new
elevation. The Edit tab's reference picker shows reference samples only.

The Studio tour has a Samples step right after "Prompt and references" (studio tour and beta tour), and
the first-run hints mention samples.

## How a design becomes an elevation

`POST /api/references/stock/:id/use` copies the sample into the caller's own storage
(`elevations/<clerk id>/…`) and returns a signed link to the copy, which the Studio places like any
upload (`placeSampleDesign` in `useElevationUpload`). It is a copy rather than a link to the shared
sample on purpose:

- an admin hiding or deleting a sample later cannot break a user's project or its renders;
- the copy counts toward the user's storage like their own upload (samples are WebP under 600 KB), and
  is refused with the usual storage-quota dialog if they are full;
- renders and edits treat it as the user's own image from then on.

Only design categories can be used this way (reference samples return `400 not_a_design`). Hidden or
unknown samples return `404`.

## Admin

**Admin → Samples** (the old "Reference library" page; the URL `/library`, the `library.manage`
permission and the `library.update` audit action keep their names so bookmarks, roles and the audit
history still work). The category chips are grouped under **References** and **Designs**. Upload,
caption, reorder, hide and delete work as before, in every category. Images are re-encoded to WebP
(1600 px, under 600 KB).

Categories with no visible image are hidden from users, and so is the Designs section. **The page ships
empty: nothing is seeded.** Until designs are uploaded, new users only see the normal upload. Whole-building
images work best (a front elevation as a 3D render, a photo and a drawing of a house).

## Code

- Categories and helpers: `REFERENCE_CATEGORIES`, `DESIGN_CATEGORIES`, `SAMPLE_CATEGORIES`,
  `isDesignCategory` in `packages/types`. The database column is plain text, so the new categories need
  no migration.
- API: `routes/references.ts` (`GET /stock`, `POST /stock/:id/use`), `routes/admin/library.ts`.
- Studio: `shell/panel/SamplesDialog.tsx`, `lib/useSamples.ts` (one cached list, refreshed every 30
  minutes because the links are signed), `shell/panel/ReferenceBar.tsx`.
- Tests: `apps/api/test/samples.test.ts`.
