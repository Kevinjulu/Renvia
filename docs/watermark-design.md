# Watermark design: layout, artwork and how to rebrand it

## Purpose

Free-plan renders are served only as a watermarked copy. The watermark is a level grid of brand marks (a symbol plus a wordmark) with faint dashed crosses between them. It is the kind of pattern stock-image and architectural-visualisation sites use. It covers the whole image evenly, yet facades, windows and materials stay readable.

This document records the design precisely enough to rebuild it for another brand. The layout is `overlaySvg()` in [apps/api/src/lib/watermarkOverlay.ts](../apps/api/src/lib/watermarkOverlay.ts); the artwork inside each tile comes from [packages/brand/src/watermark.js](../packages/brand/src/watermark.js).

![Reference render with the watermark applied](images/watermark-reference.png)

One mark unit, shown at 45% opacity on a mid-tone background:

![One mark unit](images/watermark-mark.svg)

## Versions

The layout (grid, crosses, opacity, colour, scaling) has never changed. Only the artwork in each tile has, and each change bumps `WATERMARK_VERSION` in [watermark.ts](../apps/api/src/lib/watermark.ts) so stored copies are remade.

| Version | Artwork | Notes |
| --- | --- | --- |
| 1 | RENVIA (first design) | Copies stored under the link's own key, `watermarked/...`. |
| 2 | RENVIA, redrawn | Copies stored under `watermarked-v2/...`. [Reference](images/watermark-reference-v2.png), [mark](images/watermark-mark-v2.svg). |
| 3 | RAMAH STUDIO INTERNATIONAL | Current. Copies under `watermarked-v3/...`, thumbnails under `thumbs/watermarked-v3/...`. |

## Anatomy

The overlay has two layers. Both are pure white, and each layer has a single opacity.

| Layer | What it is | Opacity |
| --- | --- | --- |
| Marks | Symbol + wordmark, repeated on a straight grid | 0.45 |
| Crosses | A thin dashed X in each gap between four marks | 0.50 |

There is no shadow, outline, rotation, corner badge or randomness. On bright surfaces such as a white wall, the mark nearly disappears; that is intended. Coverage comes from the repetition, not from contrast.

## Measurements

All numbers are pixels on an image whose **long side is 1536px**. For any other size, every value is multiplied by `longSide / 1536`. A 1536 × 1024 render and a 1024 × 1536 render therefore use marks of the same size, and an 8K export looks identical to the preview, just sharper.

### Mark unit (191 × 49)

The unit is a fixed box. The crosses' arm tips land at (−1, −2), (185, −2), (−1, 55) and (185, 55) relative to each mark, so they frame its corners: artwork must fit the box rather than the box growing to fit the artwork.

### Grid

| Setting | Value |
| --- | --- |
| Column step | 326 |
| Row step | 179 |
| First mark's top-left | (65, 56) |
| Rows | Aligned, not staggered |

On a 1536 × 1024 image this gives 5 columns × 6 rows. Marks at the right and bottom edges are allowed to run off the image.

### Crosses

| Setting | Value |
| --- | --- |
| Position | centre at (−71, −63) from each mark's top-left, i.e. up and left of every mark |
| Arm half-extent | 70 across × 61 down, so roughly 41° rather than 45° |
| Stroke | 1, dashed `14 5` |

Because every mark owns the cross above-left of it, crosses also appear along the top and left edges.

These values are pinned by [watermarkOverlay.pure.test.ts](../apps/api/test/watermarkOverlay.pure.test.ts), including hashes of the grid taken from the version 2 overlay with the artwork removed, so an artwork change cannot move the layout.

## Version 3 artwork: RAMAH STUDIO INTERNATIONAL

Inside the 191 × 49 box:

| Part | Placement |
| --- | --- |
| RS symbol | Left, 45 tall, vertically centred. The orbit is cropped to the R and S so it does not widen the unit. |
| Gap | 12 |
| RAMAH STUDIO over *international* | Fills the rest of the width (about 117), vertically centred. Capitals come out about 10.6 tall at 1536px. |

The artwork is the owner's logo, reconstructed as vectors from the reference PNG (see [packages/brand/scripts/vectorize.mjs](../packages/brand/scripts/vectorize.mjs)). The watermark uses a **watermark cut** of it:

- **Bolder by a fixed amount.** At about a tenth of the logo's reference size and 0.45 opacity, the serif hairlines would fall below a pixel and vanish. The cut grows every edge by 3.2 reference px for the wording and 1.9 for the symbol, about 0.3 and 0.2 px at watermark size. Letterforms and serifs are unchanged; only the thinnest strokes gain visible weight.
- **Baked into the geometry, not a runtime stroke.** A stroke on the paths doubles the time to mark an 8K image; the baked cut costs about 0.75 s more than version 2 at 7680 × 4296 (2.6 s against 1.8 s), with the same peak memory.
- **Filled white paths only.** No `<text>`, fonts, strokes, gradients or `url()` references.
- In 640px grid thumbnails the wording reads as texture; the RS symbol stays recognisable.

## Version 2 artwork: RENVIA (retired)

Kept for history. A faceted R monogram (42 × 49) and the RENVIA wordmark as 2px strokes on a 127 × 20 grid, starting 64.7 from the monogram's left edge, its top at 16.5. The paths remain in `renviaWatermarkMark` in [packages/brand/src/watermark.js](../packages/brand/src/watermark.js); a brand test pins them.

The monogram was a geometric R built from two filled shapes: a 7-thick top bar running into a round bowl (outer radius 12.75, inner 6) and a leg to the bottom-right corner, plus a separate 6.7-wide stem with parallel slanted cuts. The wordmark followed Montserrat Light (300) proportions, drawn as monoline strokes at 10% of the 20 cap height with tracking of about 0.28em.

## How it is applied

1. `overlaySvg(width, height)` builds one SVG the size of the image. The mark and the cross are each defined once and placed with `<use>`, so the SVG stays small at any resolution.
2. `watermarkImage()` composites it over the upright-rotated image with Sharp (librsvg) and keeps the input format: PNG stays PNG, WebP and JPEG are saved at quality 90.
3. The copy is made the first time a `watermarked/...` link is opened. It is stored under `watermarked-v<WATERMARK_VERSION>/...` and reused after that. The clean original is never modified, and edits always start from it.
4. A grid thumbnail (`?size=thumb`) of a watermarked link is made from that copy and stored under `thumbs/watermarked-v<WATERMARK_VERSION>/...` (`servedThumbnailKey`), so a new design never reuses an old thumbnail.
5. Deleting a project removes every stored version of each output's watermarked copy and their thumbnails (`watermarkedCopyKeys`).

### After a version change

- **Links don't change.** The Studio keeps issuing `watermarked/...` links; the API serves the new version from them.
- **Browsers converge within about 14 hours.** A watermarked link is reissued unchanged for 14 hours, and the browser may keep its redirect and image for that link. Once a new link is issued, it fetches the new version. A tab left open on an old link could show the old design for up to the link's 7-day life.
- **Older copies stay in storage until cleaned up.** Version 2 copies (`watermarked-v2/...`) and unversioned thumbnails (`thumbs/watermarked/...`) are no longer served but are not deleted automatically. Do not delete them until at least 8 days after the new version is live, because a cached redirect can still point at them for up to 7 days.

### Cleaning up older versions

[apps/api/scripts/cleanup-watermarks.ts](../apps/api/scripts/cleanup-watermarks.ts) removes them. Run it from `apps/api`:

```
node --env-file=.env.local scripts/cleanup-watermarks.ts                    # dry run: counts, sizes, examples
node --env-file=.env.local scripts/cleanup-watermarks.ts --reclassify       # fix ledger kinds; deletes nothing
node --env-file=.env.local scripts/cleanup-watermarks.ts --apply --confirm <count>
```

- **What it can delete:** only keys that `obsoleteWatermarkVersion()` in [watermarkVersions.ts](../apps/api/src/lib/watermarkVersions.ts) recognises, i.e. watermarked copies and thumbnails of render outputs from a version older than `WATERMARK_VERSION`. Originals, uploads, other thumbnails, stock and feedback never match; a test pins this.
- **Where it looks:** the bucket, under the watermark prefixes only, not the storage ledger, because objects stored before the ledger existed are only in the bucket.
- **Safeguards:** `--apply` needs `--confirm` with the exact count the dry run found, and refuses until 8 days after the current version first stored a copy (read from the ledger).
- **How it deletes:** in batches of up to 1000; a key's ledger row is removed only once the bucket confirms that key's deletion. Running it again is harmless.
- **`--reclassify`** fixes ledger rows for versioned copies recorded as uploads by an earlier bug in `storageKindFor`.

When version 3 went live (first copy stored 2026-10-20 06:54 UTC) the dry run found 36 version 2 copies (13.5 MB) and 23 unversioned thumbnails (0.8 MB); deleting them is allowed from 2026-10-28.

## Rebranding for another brand

1. **Artwork.** Put the brand's filled vector paths in `packages/brand`: for a raster-only logo, use `scripts/vectorize.mjs` (it also produces the watermark cut). Keep a horizontal unit, symbol left and wording right, inside the 191 × 49 box.
2. **Colour.** The design stays white. A brand colour at these opacities turns muddy on photographs, and white reads as neutral on both sky and stone.
3. **Point `watermarkMark`** in `packages/brand/src/watermark.js` at the new artwork, and **bump `WATERMARK_VERSION`**.
4. **Check it visually.** Composite onto a dusk render, a daylight render with white walls, a portrait image, a 640px thumbnail and a 7680px export. Confirm that the marks sit on a level grid, nothing looks clipped or blurry, and the building details stay readable. Time the 8K export.
5. **Clean up** the previous version's copies once the grace period has passed.

## Values at a glance

```
BASE_SIDE      1536   long side the numbers below are measured on
mark unit      191 × 49   (v3: symbol 45 tall at left, gap 12, wording fills the rest)
grid           326 × 179, first mark at (65, 56), rows aligned
cross          centre (−71, −63) from each mark, arms ±70 × ±61, stroke 1, dash 14/5
colour         #fff
opacity        marks 0.45, crosses 0.50
version        3 (RAMAH STUDIO INTERNATIONAL)
```
