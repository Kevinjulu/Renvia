import { watermarkMark } from "@renvia/brand/watermark";

/**
 * The watermark's layout: a level grid of brand marks laced with dashed crosses. This is the
 * fixed part of the design; only the mark artwork (from @renvia/brand) changes with the brand.
 * Units are pixels on an image whose long side is BASE_SIDE; the overlay scales them to the
 * image's long side. See docs/watermark-design.md.
 */
export const WATERMARK_GEOMETRY = {
  BASE_SIDE: 1536,
  // Marks repeat on a straight grid, offset so the first sits just inside the top-left corner.
  COLUMN_STEP: 326,
  ROW_STEP: 179,
  FIRST_MARK: { x: 65, y: 56 },
  // A dashed X sits in each gap between four marks, its arms reaching toward their corners.
  CROSS_ARM: { x: 70, y: 61 },
  // Where each cross sits relative to the mark below and to the right of it.
  CROSS_OFFSET: { x: -71, y: -63 },
  CROSS_DASH: "14 5",
  CROSS_STROKE_WIDTH: 1,
  MARK_OPACITY: 0.45,
  CROSS_OPACITY: 0.5,
} as const;

const { BASE_SIDE, COLUMN_STEP, ROW_STEP, FIRST_MARK, CROSS_ARM, CROSS_OFFSET } = WATERMARK_GEOMETRY;

const CROSS = `<path d="M${-CROSS_ARM.x} ${-CROSS_ARM.y}L${CROSS_ARM.x} ${CROSS_ARM.y}M${CROSS_ARM.x} ${-CROSS_ARM.y}L${-CROSS_ARM.x} ${CROSS_ARM.y}" stroke="#fff" stroke-width="${WATERMARK_GEOMETRY.CROSS_STROKE_WIDTH}" stroke-dasharray="${WATERMARK_GEOMETRY.CROSS_DASH}"/>`;

/** The overlay for a w x h image: a grid of brand marks laced with dashed crosses. */
export function overlaySvg(width: number, height: number): string {
  // The mark scales with the image so it reads the same on a thumbnail and on an 8K export.
  const scale = Math.max(width, height) / BASE_SIDE;
  const cols = Math.ceil(width / scale / COLUMN_STEP) + 1;
  const rows = Math.ceil(height / scale / ROW_STEP) + 1;
  const marks: string[] = [];
  const crosses: string[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = FIRST_MARK.x + col * COLUMN_STEP;
      const y = FIRST_MARK.y + row * ROW_STEP;
      marks.push(`<use xlink:href="#mark" x="${x}" y="${y}"/>`);
      // Each cross sits up and to the left of its mark, so the top row and left column get one too.
      crosses.push(`<use xlink:href="#cross" x="${x + CROSS_OFFSET.x}" y="${y + CROSS_OFFSET.y}"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}">
  <defs>
    <g id="mark">${watermarkMark.svg}</g>
    <g id="cross">${CROSS}</g>
  </defs>
  <g transform="scale(${scale})">
    <g opacity="${WATERMARK_GEOMETRY.CROSS_OPACITY}">${crosses.join("")}</g>
    <g opacity="${WATERMARK_GEOMETRY.MARK_OPACITY}">${marks.join("")}</g>
  </g>
</svg>`;
}
