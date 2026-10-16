# Image pipeline: compression, thumbnails and serving

How Renvia stores and serves images, why it works this way, and how it was tested. The work was done and deployed on 2026-10-16, in commits `2a550b7`, `e715571` and `f48bf3d`.

## Where it started

An audit of the codebase found:

| Area | Before |
| --- | --- |
| AI render results | Already compressed: the models are asked for JPEG at about 1K. |
| 4K/8K upscales | Already compressed: JPEG quality 92 with full-resolution colour (4:4:4). |
| Admin reference library, beta screenshots | Already compressed: WebP, capped at 1600px and 2048px. |
| **User uploads** (elevations, references, assets, pasted links) | **Stored exactly as sent.** Up to 10 MB each, original format, EXIF (including phone GPS location) kept. |
| **Grids, cards and tables** | **No thumbnails.** Project cards, the filmstrip, Assets and every admin table downloaded full-size originals to draw 64px tiles. |
| **Serving** | **Every image view streamed the whole file through a Vercel function,** using function time and Vercel's 100 GB/month transfer allowance. |

Images live in Cloudflare R2 (bucket `renviadb`), not the database. Neon only holds each image's URL and a byte count in the `storage_objects` ledger, which enforces the storage cap that keeps us inside R2's free 10 GB.

## What we built

### 1. Server-side compression of uploads

`optimizeUpload` in `apps/api/src/lib/optimizeImage.ts` runs on every `POST /api/uploads` and on pasted-link imports (`routes/references.ts`).

Every upload is turned upright (EXIF orientation applied to the pixels), capped at **2560px** on its long edge and stripped of metadata. The render models work at about one megapixel, so 2560px keeps every detail they can use. Then:

| Input | Stored as |
| --- | --- |
| JPEG | JPEG, quality 90, 4:4:4 colour (mozjpeg). |
| PNG | Lossless PNG, so line elevations keep crisp edges and transparency. A PNG with no transparency that is still over 3 MB after capping is a photo in practice, and becomes JPEG quality 92. |
| WebP | WebP quality 90, alpha kept. |
| Unreadable file | Rejected with a 400 ("That file isn't a readable PNG, JPEG or WebP image."). Previously it was stored. |

Rules that protect quality and size:

- **Small, clean images are stored as sent.** An image that is already within 2560px, upright, metadata-free and at most 3 MB is not re-encoded. This is what a Studio-shrunk photo looks like, so it isn't JPEG-compressed twice.
- **A JPEG never grows just to lose its EXIF.** When no resize or rotation is needed, the EXIF/XMP (APP1) and IPTC (APP13) segments are cut out of the file without re-encoding (`withoutJpegMetadata`). The pixels are untouched and the ICC colour profile is kept. The smaller of that and a re-encode is stored.
- **Selection masks are stored exactly as drawn.** The Studio sends them with the header `X-Upload-Kind: mask`. Compressing or resizing a mask would blur the edge of the edited area.

### 2. Thumbnails

Adding `&size=thumb` to any signed image link returns a **640px WebP** (typically 12–40 KB) instead of the full image.

- **Created on first request.** The thumbnail is made the first time it's asked for, stored under `thumbs/<key>.webp`, and served from storage after that. Images from before this change get thumbnails without any backfill.
- **Watermarks carry over.** A thumbnail of a watermarked link is made from the watermarked copy.
- **Same access rules.** The signature covers the image key, so a thumbnail grants nothing the full link doesn't.
- **Counted and cleaned up.** Thumbnails are counted in the storage ledger as kind `thumbnail` and shown in the admin storage panel. Once storage is at its cap they're made for each request and not stored. A render's thumbnails are deleted with its project, and a library image's thumbnail with the image.
- **Where they're used.** The client helper `thumbnailUrl()` in `@renvia/types` adds the parameter to our own signed links and leaves `blob:`, `data:` and external URLs unchanged.
  - Studio: project cards, filmstrip, elevation card, Assets grid, reference tiles, results-panel tiles, edit-target thumb, edit-reference tags, feedback render picker.
  - Admin: Renders, Projects, Overview, Segmentations and Library tables.
  - Full-size images still load on the canvas, in previews, in detail drawers and for downloads.

### 3. Shrinking photos in the browser before upload

`apps/studio/src/lib/shrinkForUpload.ts` runs before the upload request in `apiClient.ts`. Phase 1 can't speed up the upload itself, because the file has already been sent by then; this does.

- **Which files:** JPEG and WebP photos over **1.5 MB**.
- **What happens:** the photo is drawn to a canvas, capped at 2560px (the API's limit), turned upright and re-saved at quality 0.92. A 12 MB phone photo is sent as roughly 1–2 MB. This uses the browser's built-in canvas, with no extra package.
- **What's left alone:** PNGs are sent untouched, because that's how line elevations arrive and they must stay lossless. Masks are never touched.
- **Fallbacks:** any failure, a copy that isn't smaller, or a browser that can't save WebP (Safari returns PNG) sends the original file.
- **Larger photos now work:** a photo over the 10 MB upload limit used to be rejected. It's now shrunk under the limit before it leaves the browser.

### 4. Serving images straight from R2

Image links are unchanged: `https://<api>/api/uploads/<key>?expires=…&signature=…`. Nothing in the database or the clients had to change. What `GET /api/uploads/<key>` does now (`routes/uploads.ts`):

1. It verifies the app signature, as before.
2. For a watermarked link or a thumbnail, it makes and stores the copy if it doesn't exist. The existence check is a `HEAD`, so nothing is downloaded.
3. It redirects (`302`) to a **presigned R2 link** (`directObjectUrl` in `lib/storage.ts`) that expires no later than the app link. The browser downloads the bytes from Cloudflare; Vercel only sends a tiny redirect.

Details:

- **Stable links:** direct links are signed at the start of the hour, so repeat requests get the same URL and the browser cache keeps working.
- **Caching:** the redirect is `Cache-Control: private`, cached by the browser only. The R2 response carries `private, max-age=604800, immutable`, because objects never change once written.
- **Fallback:** if a watermark or thumbnail couldn't be stored (storage at its cap), its bytes are sent directly with `no-store`.

**Why not a public bucket or CDN.** A public bucket would let free-plan users open clean render originals by guessing the key (`renders/<renderId>.jpg`), which defeats the watermark. Caching the redirect on Vercel's CDN would mix CORS headers between the Studio and admin origins. Signed links stay the only way in.

**R2 CORS rule (required).** The Studio fetches images with `fetch(…, { mode: "cors" })` for downloads (`DownloadDialog`) and previews (`ImagePreview`). When a cross-origin request is redirected to another origin, the browser sends `Origin: null`, so the bucket must allow any origin. The presigned link is the access control. The rule set on `renviadb`:

```json
{"rules":[{"allowed":{"origins":["*"],"methods":["GET","HEAD"],"headers":["*"]},"maxAgeSeconds":86400}]}
```

The app's storage key can't read or set bucket CORS (AccessDenied), so it was set with Wrangler:

```
npx wrangler@4 login
npx wrangler@4 r2 bucket cors set renviadb --file r2-cors.json
npx wrangler@4 r2 bucket cors list renviadb
```

### 5. Backfill of existing uploads

`apps/api/scripts/backfill-images.ts` applies `optimizeUpload` to everything under `elevations/` stored before compression existed.

- **Same keys:** every file keeps its key, so all stored URLs keep working. Only the bytes and the Content-Type change, and the ledger is updated.
- **Masks are skipped:** any upload a render references as its `maskImageUrl` is left alone.
- **Safe by default:** it's a dry run unless given `--apply <backupDir>`, which saves each original to that local folder before overwriting it.

```
cd apps/api
node --env-file=.env.local scripts/backfill-images.ts                       # dry run
node --env-file=.env.local scripts/backfill-images.ts --apply <backupDir>   # write
```

Production run on 2026-10-16:

- **29 of 59** uploads were rewritten, taking them from **10.6 MB to 9.6 MB**. 3 masks were left untouched.
- **Mostly a privacy change:** most of the gain is EXIF/GPS removal from small JPEGs. The one large photo went from 1.9 MB to 0.96 MB.
- **Originals backed up** to `tmp/image-backup-2026-10-16/` on the developer machine. That folder is git-ignored and laid out like the bucket, so a file can be restored by uploading it back to the same key.
- **Confirmed complete:** a second dry run afterwards reported 0 of 59 left to change.

## Tests and checks

| Check | How | Result |
| --- | --- | --- |
| Typecheck and lint, all apps | `pnpm typecheck`, `pnpm lint` after each phase | Pass. Two pre-existing lint warnings, unrelated. |
| Compression policy | Synthetic images run through `optimizeUpload` | 4000×3000 rotated phone JPEG → 1920×2560, upright, no EXIF. Line-drawing PNG stays PNG (140 KB → 20 KB). Transparent PNG keeps alpha. 15 MB photo-as-PNG → 4.3 MB JPEG. Small low-quality JPEG untouched. Garbage bytes rejected with the user message. |
| Thumbnail output | `makeThumbnail` on a 12 MP photo | 34 KB WebP, 640px long edge. |
| No growth on real uploads | Backfill dry run against production | First run found small EXIF-bearing JPEGs growing 30–50% when re-encoded. This led to the lossless metadata strip; the re-run showed no file growing. |
| Lossless metadata strip | Two real uploads, decoded before and after | Pixels byte-identical, EXIF gone, ICC profile kept. |
| R2 presigned links | Read-only presigned GET of a real object | 200, correct Content-Type, the `response-cache-control` override honoured by R2. |
| R2 CORS | Presigned GET with `Origin: null` after setting the rule | `Access-Control-Allow-Origin: *`. |
| Backfill | Dry run, then `--apply`, then dry run again | 29 rewritten with 29 backups; the second dry run found 0 left. |
| Production after deploy | Signed link to a real upload against `renvia-api.vercel.app` | Full image: `302` to R2. `&size=thumb`: `302` to R2, 12 KB WebP served. |

Not covered:

- **API test suite:** `apps/api` vitest needs a local Postgres test database, and wasn't run for this work.
- **Browser checks:** the Studio and admin haven't been checked in a real browser after deploy. Check these by hand:
  - The network tab shows image `302`s to `r2.cloudflarestorage.com`.
  - Render download and image preview work.
  - A large phone photo uploads as a much smaller request.
  - An edit with a selected area still uploads its mask.
  - Admin tables show thumbnails. The first visit is slower while they're made.

## Deploy order

1. **R2 CORS rule first.** Without it, downloads and previews fail as soon as the new API redirects to R2.
2. **API before, or together with, the Studio.** The Studio sends `X-Upload-Kind`, which the API must allow in its CORS headers. A new Studio against an old API has every mask upload blocked by the browser, so selection edits fail. An old Studio against a new API works.

All apps deploy from `main` through Vercel's git integration, so a single push deploys them together.

## Files

| File | Role |
| --- | --- |
| `apps/api/src/lib/optimizeImage.ts` | `optimizeUpload`, `makeThumbnail`, lossless JPEG metadata strip. |
| `apps/api/src/routes/uploads.ts` | Upload compression, mask opt-out, thumbnail creation, redirect to R2. |
| `apps/api/src/lib/storage.ts` | `thumbnailKeyFor`, `objectExists`, `directObjectUrl`, `thumbnail` ledger kind. |
| `apps/api/src/lib/watermark.ts` | `watermarkedCopy` returns the stored copy's key so it can be redirected to. |
| `apps/api/src/routes/references.ts` | Pasted-link imports go through `optimizeUpload`. |
| `apps/api/src/routes/projects.ts`, `routes/admin/library.ts` | Delete thumbnails with their originals. |
| `apps/api/src/index.ts` | `X-Upload-Kind` allowed in CORS. |
| `apps/api/scripts/backfill-images.ts` | One-off backfill of old uploads. |
| `apps/studio/src/lib/shrinkForUpload.ts` | Browser-side shrinking before upload. |
| `apps/studio/src/lib/apiClient.ts` | Calls `shrinkForUpload`; sends `X-Upload-Kind: mask` for masks. |
| `packages/types/src/index.ts` | `thumbnailUrl()` helper; `thumbnail` in the storage breakdown type. |
| `packages/db/src/schema.ts` | `thumbnail` added to the ledger's kind values (text column, no migration). |

## Constants worth knowing

| Constant | Value | Where |
| --- | --- | --- |
| `MAX_UPLOAD_EDGE` | 2560px | `optimizeImage.ts` and `shrinkForUpload.ts` (keep them equal) |
| `THUMBNAIL_EDGE` | 640px | `optimizeImage.ts` |
| `STORE_AS_SENT_BYTES` | 3 MB | `optimizeImage.ts` |
| `LARGE_OPAQUE_PNG_BYTES` | 3 MB | `optimizeImage.ts` |
| `SHRINK_ABOVE_BYTES` | 1.5 MB | `shrinkForUpload.ts` |
| Direct link signing window | 1 hour | `storage.ts` |
| Max direct link life | 7 days (S3 signing limit) | `storage.ts` |
