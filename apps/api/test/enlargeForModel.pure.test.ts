import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { enlargeForModel, MIN_MODEL_INPUT_EDGE } from "../src/lib/engine.js";
import { editReferencesFor } from "../src/lib/engine.js";

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: "#b0533c" } }).jpeg().toBuffer().then((buffer) => new Uint8Array(buffer));

async function size(bytes: Uint8Array) {
  const { width, height } = await sharp(bytes).metadata();
  return { width, height };
}

describe("enlargeForModel", () => {
  it("leaves an image that is already big enough alone", async () => {
    expect(await enlargeForModel(await solid(800, 600))).toBeNull();
  });

  it("enlarges a small swatch so its short edge meets the minimum", async () => {
    const enlarged = await enlargeForModel(await solid(200, 150));
    expect(enlarged?.contentType).toBe("image/jpeg");
    const { width, height } = await size(enlarged!.bytes);
    expect(height).toBe(MIN_MODEL_INPUT_EDGE);
    expect(width).toBe(683);
  });

  it("pads a long thin strip that can't be enlarged far enough", async () => {
    const { width, height } = await size((await enlargeForModel(await solid(2000, 20)))!.bytes);
    expect(width).toBe(4096);
    expect(height).toBeGreaterThanOrEqual(256);
  });

  it("returns null for bytes that aren't an image", async () => {
    expect(await enlargeForModel(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("editReferencesFor", () => {
  it("fills untagged references in as the whole look", () => {
    expect(editReferencesFor({ mode: "building", references: [{ target: "roof" }] }, 3)).toEqual([{ target: "roof" }, { target: "look" }, { target: "look" }]);
    expect(editReferencesFor({ mode: "building" }, 0)).toEqual([]);
  });
});
