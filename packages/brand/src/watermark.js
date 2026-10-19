/**
 * Watermark artwork, for the API only (imported as "@renvia/brand/watermark").
 *
 * A watermark mark is one white unit drawn on a 191 x 49 box, in pixels of a 1536px image. The
 * box is fixed by the watermark grid: the dashed crosses' arm tips frame its corners (see
 * docs/watermark-design.md). Filled paths only, never <text> or strokes: the API renders with
 * librsvg on Vercel, where no fonts are installed, and strokes double the time to mark an 8K image.
 */
import { watermarkBounds, watermarkPaths } from "./watermarkPaths.js";

const UNIT = { width: 191, height: 49 };

/**
 * The RENVIA artwork the watermark has shipped with (version 2): a faceted R monogram (42 x 49)
 * and the RENVIA wordmark as 2px strokes on a 127 x 20 grid, 64.7 from the monogram's left edge.
 */
const RENVIA_MONOGRAM = [
  "M0 0H26A12.75 12.75 0 0 1 26 25.5H22.5L41.7 49H30.5L6.5 19H26A6 6 0 0 0 26 7H6.7Z", // bar, bowl, leg
  "M0 22L6.7 27.3V46.5L0 42Z", // stem
].join("");
const RENVIA_WORDMARK = [
  "M1 19V1H8.5A5.25 5.25 0 0 1 8.5 11.5H1M8.5 11.5L14.8 19", // R
  "M37.3 1H24.3V19H37.3M24.3 10H36", // E
  "M48.5 19V1L62.3 19V1", // N
  "M72.6 1L80.8 19L89 1", // V
  "M99.2 1V19", // I
  "M108.4 19L117.1 1L125.8 19M111.5 12.6H122.7", // A
].join("");

export const renviaWatermarkMark = Object.freeze({
  ...UNIT,
  svg: `<path d="${RENVIA_MONOGRAM}" fill="#fff"/><path d="${RENVIA_WORDMARK}" transform="translate(64.7 16.5)" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>`,
});

/**
 * The RAMAH STUDIO artwork: the RS symbol on the left (45 tall, orbit cropped to the R and S),
 * then RAMAH STUDIO over the italic "international", filling the rest of the box and centred on
 * the symbol. Both are the watermark cut from watermarkPaths.js: the logo made slightly bolder so
 * its hairlines survive at this size and opacity.
 */
const SYMBOL_HEIGHT = 45;
const GAP = 12;
const fit = (box, x, y, scale) => `translate(${+x.toFixed(3)} ${+y.toFixed(3)}) scale(${+scale.toFixed(6)}) translate(${-box[0]} ${-box[1]})`;
const symbolBox = watermarkBounds.symbol, nameBox = watermarkBounds.name;
const symbolScale = SYMBOL_HEIGHT / (symbolBox[3] - symbolBox[1]);
const nameX = (symbolBox[2] - symbolBox[0]) * symbolScale + GAP;
const nameScale = (UNIT.width - nameX) / (nameBox[2] - nameBox[0]);
const nameY = (UNIT.height - (nameBox[3] - nameBox[1]) * nameScale) / 2;

export const ramahWatermarkMark = Object.freeze({
  ...UNIT,
  svg:
    `<path transform="${fit(symbolBox, 0, (UNIT.height - SYMBOL_HEIGHT) / 2, symbolScale)}" fill="#fff" fill-rule="evenodd" d="${watermarkPaths.symbol}"/>` +
    `<path transform="${fit(nameBox, nameX, nameY, nameScale)}" fill="#fff" fill-rule="evenodd" d="${watermarkPaths.name}"/>`,
});

/** The artwork the API draws now (watermark version 3). RENVIA was version 2. */
export const watermarkMark = ramahWatermarkMark;
