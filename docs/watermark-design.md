# Watermark design: layout, typography and how to rebrand it

## Purpose

Free-plan renders are served only as a watermarked copy. The watermark is a level grid of brand marks (a monogram plus a wordmark) with faint dashed crosses between them. It is the kind of pattern stock-image and architectural-visualisation sites use. It covers the whole image evenly, yet facades, windows and materials stay readable.

This document records the design precisely enough to rebuild it for another brand. The implementation is `overlaySvg()` in [apps/api/src/lib/watermark.ts](../apps/api/src/lib/watermark.ts).

![Reference render with the watermark applied](images/watermark-reference.png)

One mark unit, shown at 45% opacity on a mid-tone background:

![One mark unit](images/watermark-mark.svg)

## Anatomy

The overlay has two layers. Both are pure white, and each layer has a single opacity.

| Layer | What it is | Opacity |
| --- | --- | --- |
| Marks | Monogram + wordmark, repeated on a straight grid | 0.45 |
| Crosses | A thin dashed X in each gap between four marks | 0.50 |

There is no shadow, outline, rotation, corner badge or randomness. On bright surfaces such as a white wall, the mark nearly disappears; that is intended. Coverage comes from the repetition, not from contrast.

## Measurements

All numbers are pixels on an image whose **long side is 1536px**. For any other size, every value is multiplied by `longSide / 1536`. A 1536 × 1024 render and a 1024 × 1536 render therefore use marks of the same size, and an 8K export looks identical to the preview, just sharper.

### Mark unit (191 × 49)

| Part | Value |
| --- | --- |
| Monogram box | 42 wide × 49 tall |
| Gap, monogram to wordmark | 23 (wordmark starts 64.7 from the monogram's left edge) |
| Wordmark box | 127 wide × 20 cap height |
| Wordmark vertical position | top at 16.5, so its centre sits 2px below the monogram's centre |
| Wordmark stroke | 2 (10% of cap height), round joins, butt caps |

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

## The monogram

It is a faceted geometric R built from two filled shapes on a 42 × 49 grid:

1. **Bar, bowl and leg (one shape).** A 7-thick top bar whose left end is cut on a diagonal from (0,0) to (6.7,7). The bar runs into a round bowl (outer radius 12.75, inner radius 6), and the bowl's lower stroke flows straight into the leg. The leg is about 11 wide and drops to the bottom-right corner (41.7, 49). The bowl is open on the left: nothing joins it to the stem.
2. **Stem.** A separate 6.7-wide upright that starts below the bowl. Its top and bottom are cut on parallel slants: (0,22)→(6.7,27.3) and (0,42)→(6.7,46.5).

The gap between the stem and the bowl, and the slanted cuts, are what give it the "architectural" look. Keep both if the monogram is redrawn.

```
M0 0H26A12.75 12.75 0 0 1 26 25.5H22.5L41.7 49H30.5L6.5 19H26A6 6 0 0 0 26 7H6.7Z   bar, bowl, leg
M0 22L6.7 27.3V46.5L0 42Z                                                            stem
```

## Typography

**Style reference: Montserrat Light (300), uppercase, wide tracking.** The wordmark is not set in a font, though. Each letter is drawn as stroke paths with plain geometric construction.

Why paths: the API composites the overlay with Sharp (librsvg) on Vercel, where no fonts are installed. Text in a `<text>` element would silently fall back to a different font, or render nothing. Paths look the same everywhere and need no font files.

The letterforms follow these rules:

- **Cap height** is 20. **Stroke** is 2, a uniform monoline weight equal to 10% of cap height (Light weight).
- **Letter widths** are about 14–17. V and A are wider (about 17–18), and I is just its stroke.
- **Tracking:** the gap between letters is 7.5–9.5, roughly 0.28em at the equivalent Montserrat size of about 28.5px. That is much wider than normal text and is what makes it read as a premium brand mark.
- **Construction:** straight lines and circular arcs only. R has a round bowl from y 1 to 11.5 with the leg leaving from the bowl's join. E's middle bar is slightly shorter than its top and bottom bars. A's crossbar sits low, at 63% of cap height. V and A are pointed, with no flat apex.

| Letter | Path (on the 127 × 20 grid) |
| --- | --- |
| R | `M1 19V1H8.5A5.25 5.25 0 0 1 8.5 11.5H1M8.5 11.5L14.8 19` |
| E | `M37.3 1H24.3V19H37.3M24.3 10H36` |
| N | `M48.5 19V1L62.3 19V1` |
| V | `M72.6 1L80.8 19L89 1` |
| I | `M99.2 1V19` |
| A | `M108.4 19L117.1 1L125.8 19M111.5 12.6H122.7` |

## How it is applied

1. `overlaySvg(width, height)` builds one SVG the size of the image. The mark and the cross are each defined once and placed with `<use>`, so the SVG stays small at any resolution.
2. `watermarkImage()` composites it over the upright-rotated image with Sharp and keeps the input format: PNG stays PNG, WebP and JPEG are saved at quality 90.
3. The copy is made the first time a `watermarked/...` link is opened. It is stored under `watermarked-v<WATERMARK_VERSION>/...` and reused after that. The clean original is never modified, and edits always start from it.

## Rebranding for another brand

1. **Monogram.** Take the brand's symbol as a filled SVG path. If it has strokes, convert them to outlines first (Figma: *Outline stroke*; Inkscape: *Stroke to Path*). Scale it so its height is about 49, set the top-left to (0,0), and replace `MONOGRAM_PATH`.
2. **Wordmark.** There are two options:
   - *Draw it* the way RENVIA is drawn: stroke paths at 20 cap height and 2 stroke, using the tracking rules above. This is best for short, geometric names.
   - *Outline a real font:* set the name in the brand font at a size giving 20px cap height, with tracking around 0.28em. Convert the text to outlines, then paste the result as a **filled** path: change the wordmark `<path>` to `fill="#fff"` with no stroke. Do not ship the font itself.
   Replace `WORDMARK_PATH` either way.
3. **Spacing.** Keep the 23px gap between the monogram and the wordmark. If the new unit is wider or narrower than 191, change `COLUMN_STEP` by the same amount, so that roughly 135px of empty space stays between neighbouring units. Leave `ROW_STEP`, the crosses and the opacities as they are, unless the brand mark is much taller.
4. **Colour.** The design stays white. A brand colour at these opacities turns muddy on photographs, and white reads as neutral on both sky and stone.
5. **Bump `WATERMARK_VERSION`** in `watermark.ts`. Copies already made with the old design are then remade on next open instead of being served from storage.
6. **Check it visually.** Composite onto a dusk render, a daylight render with white walls, a portrait image and a 7680px export. Confirm that the marks sit on a level grid, nothing looks clipped or blurry, and the building details stay readable.

## Values at a glance

```
BASE_SIDE      1536   long side the numbers below are measured on
mark unit      191 × 49   (monogram 42 × 49, gap 23, wordmark 127 × 20, stroke 2)
grid           326 × 179, first mark at (65, 56), rows aligned
cross          centre (−71, −63) from each mark, arms ±70 × ±61, stroke 1, dash 14/5
colour         #fff
opacity        marks 0.45, crosses 0.50
```
