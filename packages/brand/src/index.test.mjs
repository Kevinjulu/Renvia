import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { brand, brandColors, iconSvg, logoArt, logoSvg } from "./index.js";
import { logoFidelity } from "./logoPaths.js";
import { ramahWatermarkMark, renviaWatermarkMark, watermarkMark } from "./watermark.js";
import { watermarkBounds } from "./watermarkPaths.js";
import { APP_COPIES } from "../scripts/appCopies.mjs";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

test("the official names", () => {
  assert.equal(brand.legalName, "RAMAH STUDIO INTERNATIONAL");
  assert.equal(brand.displayName, "RAMAH STUDIO");
  assert.equal(brand.subtitle, "international");
  assert.equal(brand.shortName, "Ramah Studio");
  assert.equal(brand.name, "Ramah Studio International");
  assert.ok(Object.isFrozen(brand));
});

test("colour tokens are hex colours", () => {
  for (const value of Object.values(brandColors)) assert.match(value, /^#[0-9A-F]{6}$/);
});

test("every logo variant is filled path data on a valid viewBox", () => {
  for (const [variant, art] of Object.entries(logoArt)) {
    const box = art.viewBox.split(" ").map(Number);
    assert.equal(box.length, 4, variant);
    assert.ok(box.every(Number.isFinite) && box[2] > 0 && box[3] > 0, variant);
    assert.ok(art.layers.length > 0, variant);
    for (const layer of art.layers) assert.match(layer.d, /^M[-\d. MLCZ]+Z$/, variant);
  }
  // The symbol and official logo carry gold; the wordmark is one colour.
  assert.deepEqual(logoArt.wordmark.layers.map((l) => l.tone), ["ink"]);
  assert.ok(logoArt.symbol.layers.some((l) => l.tone === "gold"));
  assert.ok(logoArt.official.layers.some((l) => l.tone === "gold"));
});

test("the reconstruction stays close to the owner's artwork", () => {
  for (const [part, { iou, meanEdgeErrorPx }] of Object.entries(logoFidelity)) {
    assert.ok(iou >= 0.96, `${part} overlap ${iou}`);
    assert.ok(meanEdgeErrorPx <= 0.2, `${part} edge error ${meanEdgeErrorPx}`);
  }
});

test("standalone logos: dark is charcoal, light is ivory, gold stays gold", () => {
  const dark = logoSvg("official"), light = logoSvg("official", { tone: "light" });
  assert.match(dark, new RegExp(`fill="${brandColors.charcoal}"`));
  assert.match(light, new RegExp(`fill="${brandColors.ivory}"`));
  for (const svg of [dark, light]) {
    assert.match(svg, new RegExp(`fill="${brandColors.gold}"`));
    assert.match(svg, /<title>Ramah Studio International<\/title>/);
    assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="[\d ]+" width="\d+" height="\d+"/);
  }
  assert.doesNotMatch(logoSvg("wordmark"), new RegExp(brandColors.gold));
});

test("the app icon: rounded for browser tabs, square where the platform rounds it", () => {
  assert.match(iconSvg(), /rx="154"/);
  assert.doesNotMatch(iconSvg({ rounded: false }), /clipPath|rx=/);
  assert.match(iconSvg({ size: 180 }), /width="180" height="180"/);
});

test("the live watermark is the RAMAH STUDIO artwork; the RENVIA artwork is kept unchanged for reference", () => {
  assert.equal(watermarkMark, ramahWatermarkMark);
  assert.equal(createHash("sha256").update(renviaWatermarkMark.svg).digest("hex"), "1f497f86409bce711f686273068d92f2cd3f64e663c29c5f74704c26c4e510e2");
});

test("the RAMAH STUDIO watermark unit: white filled paths only, inside the 191 x 49 box", () => {
  const { svg, width, height } = ramahWatermarkMark;
  assert.deepEqual([width, height], [191, 49]);
  assert.doesNotMatch(svg, /<text|font|<image|url\(|gradient|stroke/i);
  for (const [, colour] of svg.matchAll(/fill="([^"]+)"/g)) assert.equal(colour, "#fff");
  // Each part's transform maps its bounds into the box.
  const transforms = [...svg.matchAll(/transform="translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\) translate\(([-\d.]+) ([-\d.]+)\)"/g)].map((m) => m.slice(1).map(Number));
  assert.equal(transforms.length, 2);
  const placed = transforms.map(([tx, ty, s], i) => {
    const b = i === 0 ? watermarkBounds.symbol : watermarkBounds.name;
    return [tx, ty, tx + (b[2] - b[0]) * s, ty + (b[3] - b[1]) * s];
  });
  for (const [x0, y0, x1, y1] of placed) {
    assert.ok(x0 >= -0.01 && y0 >= -0.01 && x1 <= width + 0.01 && y1 <= height + 0.01, `${[x0, y0, x1, y1]}`);
  }
  // Symbol on the left, the wording to its right reaching the box's right edge.
  assert.ok(placed[0][2] < placed[1][0]);
  assert.ok(Math.abs(placed[1][2] - width) < 0.01);
});

test("committed assets match the artwork, and every app serves the same icon", () => {
  assert.equal(fs.readFileSync(here("../assets/logo-official.svg"), "utf8"), logoSvg("official"));
  assert.equal(fs.readFileSync(here("../assets/logo-primary-light.svg"), "utf8"), logoSvg("wordmark", { tone: "light" }));
  assert.equal(fs.readFileSync(here("../assets/favicon.svg"), "utf8"), iconSvg());
  for (const [target, source] of Object.entries(APP_COPIES)) {
    assert.ok(fs.readFileSync(here(`../../../${target}`)).equals(fs.readFileSync(here(`../assets/${source}`))), `${target} is out of date: run pnpm --filter @renvia/brand export-assets`);
  }
});
