/**
 * Writes the brand's standalone files to assets/ and copies the app icons into each app. Run
 * after changing the artwork or icon, and commit the results:
 *
 *   pnpm --filter @renvia/brand export-assets
 *
 * Naming: "-dark" is charcoal artwork for light backgrounds, "-light" is ivory artwork for dark
 * backgrounds; the unsuffixed file is the "-dark" one.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { iconSvg, logoSvg } from "../src/index.js";
import { ramahWatermarkMark } from "../src/watermark.js";
import { APP_COPIES } from "./appCopies.mjs";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const assets = (name) => here(`../assets/${name}`);
const write = (path, content) => {
  fs.writeFileSync(path, content);
  console.log("wrote", path.replace(here("../../../"), ""));
};

const svgs = {
  "logo-primary.svg": logoSvg("wordmark"),
  "logo-primary-dark.svg": logoSvg("wordmark"),
  "logo-primary-light.svg": logoSvg("wordmark", { tone: "light" }),
  "logo-official.svg": logoSvg("official"),
  "logo-official-light.svg": logoSvg("official", { tone: "light" }),
  "logo-symbol.svg": logoSvg("symbol"),
  "logo-symbol-dark.svg": logoSvg("symbol"),
  "logo-symbol-light.svg": logoSvg("symbol", { tone: "light" }),
  // One watermark unit, white on transparent, at its 1536px-image size.
  "logo-watermark.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ramahWatermarkMark.width} ${ramahWatermarkMark.height}" width="${ramahWatermarkMark.width}" height="${ramahWatermarkMark.height}">${ramahWatermarkMark.svg}</svg>`,
  "favicon.svg": iconSvg(),
};
for (const [name, svg] of Object.entries(svgs)) write(assets(name), svg);

// Raster icons where a platform needs PNG: the Apple touch icon (iOS rounds it itself) and
// install icons.
const png = (svg, size) => sharp(Buffer.from(svg), { density: 600 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
const pngs = {
  "apple-touch-icon.png": await png(iconSvg({ rounded: false, size: 180 }), 180),
  "icon-192.png": await png(iconSvg({ rounded: false, size: 192 }), 192),
  "icon-512.png": await png(iconSvg({ rounded: false, size: 512 }), 512),
};
for (const [name, bytes] of Object.entries(pngs)) write(assets(name), bytes);

// Each app serves its own copy; brand tests check they match these.
for (const [target, source] of Object.entries(APP_COPIES)) {
  fs.copyFileSync(assets(source), here(`../../../${target}`));
  console.log("copied", source, "->", target);
}
