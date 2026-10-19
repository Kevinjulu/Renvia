import { describe, expect, it } from "vitest";
import { ramahWatermarkMark } from "@renvia/brand/watermark";
import { servedThumbnailKey, WATERMARK_VERSION, watermarkedCopyKeys } from "../src/lib/watermark.js";
import { overlaySvg } from "../src/lib/watermarkOverlay.js";

describe("watermark versions", () => {
  it("draws the RAMAH STUDIO artwork as version 3", () => {
    expect(WATERMARK_VERSION).toBe(3);
    expect(overlaySvg(1536, 1024)).toContain(`<g id="mark">${ramahWatermarkMark.svg}</g>`);
  });

  it("lists every stored copy of an output, so deleting a project leaves none behind", () => {
    const expected = ["watermarked/renders/r1.png", "watermarked-v2/renders/r1.png", "watermarked-v3/renders/r1.png"];
    expect(watermarkedCopyKeys("renders/r1.png")).toEqual(expected);
    // Same answer from the watermarked link's key.
    expect(watermarkedCopyKeys("watermarked/renders/r1.png")).toEqual(expected);
  });

  it("names a watermarked thumbnail after the current version's copy", () => {
    expect(servedThumbnailKey("watermarked/renders/r1.png")).toBe("thumbs/watermarked-v3/renders/r1.png.webp");
    // Clean images keep their thumbnail names.
    expect(servedThumbnailKey("renders/r1.png")).toBe("thumbs/renders/r1.png.webp");
    expect(servedThumbnailKey("elevations/user/a.png")).toBe("thumbs/elevations/user/a.png.webp");
  });
});
