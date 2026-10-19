/**
 * The brand's one source of truth: names, colour tokens and logo artwork, shared by the
 * marketing site, the Studio and the admin. The API's watermark artwork lives apart, in
 * "@renvia/brand/watermark", so the apps never bundle it.
 *
 * Plain JavaScript with a hand-written index.d.ts, so every runtime imports it as-is: the
 * API on Vercel's Node runtime, Vite and Next.js. No build step means no build-order
 * dependency on any Vercel project. Keep it free of React and of anything that runs on import.
 */
import { logoBounds, logoPaths } from "./logoPaths.js";

/** RAMAH STUDIO INTERNATIONAL, the official identity. */
export const brand = Object.freeze({
  legalName: "RAMAH STUDIO INTERNATIONAL",
  displayName: "RAMAH STUDIO",
  subtitle: "international",
  shortName: "Ramah Studio",
  /** The logo's accessible name: title case, so screen readers say words rather than letters. */
  name: "Ramah Studio International",
});

/**
 * Identity colours, sampled from the owner's artwork: the logo's charcoal and the average of its
 * metallic gold (the texture is flattened to this one colour). Ivory is the logo's colour on dark
 * backgrounds. The interface keeps its own palette; blueprint blue #2F6FED stays the accent.
 */
export const brandColors = Object.freeze({
  charcoal: "#101113",
  gold: "#B18C3A",
  ivory: "#F5F2EA",
});

const union = (...parts) => {
  const boxes = parts.map((part) => logoBounds[part]);
  return [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))];
};
const viewBoxOf = ([x0, y0, x1, y1]) => {
  const x = Math.floor(x0), y = Math.floor(y0);
  return `${x} ${y} ${Math.ceil(x1) - x} ${Math.ceil(y1) - y}`;
};

/**
 * The logo variants, as layers of filled paths on the reference artwork's coordinates. A layer's
 * tone is "ink" (charcoal on light backgrounds, ivory or currentColor on dark) or "gold".
 *   wordmark: RAMAH STUDIO over a smaller italic "international". Headers, sign-in, sidebars.
 *   official: the RS symbol above the wordmark. Formal and roomy placements.
 *   symbol:   the RS symbol with its globe and orbit. Collapsed sidebars and small spaces.
 */
export const logoArt = Object.freeze({
  wordmark: Object.freeze({
    viewBox: viewBoxOf(union("name", "subtitle")),
    layers: Object.freeze([Object.freeze({ tone: "ink", d: logoPaths.name + logoPaths.subtitle })]),
  }),
  official: Object.freeze({
    viewBox: viewBoxOf(union("symbolInk", "symbolGold", "name", "subtitle")),
    layers: Object.freeze([
      Object.freeze({ tone: "ink", d: logoPaths.symbolInk + logoPaths.name + logoPaths.subtitle }),
      Object.freeze({ tone: "gold", d: logoPaths.symbolGold }),
    ]),
  }),
  symbol: Object.freeze({
    viewBox: viewBoxOf(union("symbolInk", "symbolGold")),
    layers: Object.freeze([
      Object.freeze({ tone: "ink", d: logoPaths.symbolInk }),
      Object.freeze({ tone: "gold", d: logoPaths.symbolGold }),
    ]),
  }),
});

const svgAttrs = (viewBox, scale) => {
  const [, , w, h] = viewBox.split(" ").map(Number);
  return `xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${Math.round(w * scale)}" height="${Math.round(h * scale)}"`;
};

/**
 * A standalone SVG of a logo variant. tone "dark" draws charcoal artwork for light backgrounds;
 * "light" draws ivory artwork for dark ones. Gold stays gold. Intrinsic size is the reference
 * size times `scale`.
 */
export function logoSvg(variant, { tone = "dark", scale = 0.25 } = {}) {
  const art = logoArt[variant];
  const ink = tone === "light" ? brandColors.ivory : brandColors.charcoal;
  const paths = art.layers.map((layer) => `<path fill="${layer.tone === "gold" ? brandColors.gold : ink}" fill-rule="evenodd" d="${layer.d}"/>`).join("");
  return `<svg ${svgAttrs(art.viewBox, scale)} role="img"><title>${brand.name}</title>${paths}</svg>`;
}

// The app icon: the R and S on a charcoal tile, the orbit running out of the frame.
const ICON_SIDE = 700;
const ICON_CENTRE = [760, 364]; // middle of the R and S, without the orbit
const ICON_BOX = [ICON_CENTRE[0] - ICON_SIDE / 2, ICON_CENTRE[1] - ICON_SIDE / 2];

/**
 * The app icon as SVG. Rounded (22% corners, as browser tabs show it) unless `rounded` is false,
 * for platforms that round the corners themselves, such as the Apple touch icon.
 */
export function iconSvg({ rounded = true, size = 32 } = {}) {
  const [x, y] = ICON_BOX;
  const tile = `x="${x}" y="${y}" width="${ICON_SIDE}" height="${ICON_SIDE}"`;
  const art = `<path fill="${brandColors.ivory}" fill-rule="evenodd" d="${logoPaths.symbolInk}"/><path fill="${brandColors.gold}" fill-rule="evenodd" d="${logoPaths.symbolGold}"/>`;
  // The viewBox crops the orbit at the tile's edge; a rounded tile clips it to the corners too.
  const body = rounded
    ? `<clipPath id="tile"><rect ${tile} rx="${ICON_SIDE * 0.22}"/></clipPath><g clip-path="url(#tile)"><rect ${tile} fill="${brandColors.charcoal}"/>${art}</g>`
    : `<rect ${tile} fill="${brandColors.charcoal}"/>${art}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${ICON_SIDE} ${ICON_SIDE}" width="${size}" height="${size}">${body}</svg>`;
}
