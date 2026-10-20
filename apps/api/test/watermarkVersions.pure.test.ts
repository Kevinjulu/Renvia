import { describe, expect, it } from "vitest";
import { cleanupAllowedFrom, obsoleteWatermarkVersion, WATERMARK_DERIVED_PREFIXES } from "../src/lib/watermarkVersions.js";

describe("obsolete watermark copies", () => {
  it("finds copies and thumbnails of earlier versions", () => {
    expect(obsoleteWatermarkVersion("watermarked/renders/r1.png", 3)).toBe(1);
    expect(obsoleteWatermarkVersion("watermarked-v2/renders/r1-selection.png", 3)).toBe(2);
    expect(obsoleteWatermarkVersion("thumbs/watermarked/renders/r1.png.webp", 3)).toBe(1);
    expect(obsoleteWatermarkVersion("thumbs/watermarked-v2/renders/r1.png.webp", 3)).toBe(2);
  });

  it("keeps the current version's copies and thumbnails", () => {
    expect(obsoleteWatermarkVersion("watermarked-v3/renders/r1.png", 3)).toBeNull();
    expect(obsoleteWatermarkVersion("thumbs/watermarked-v3/renders/r1.png.webp", 3)).toBeNull();
  });

  it("never matches originals, uploads, other thumbnails, stock or feedback", () => {
    for (const key of [
      "renders/r1.png",
      "renders/r1-selection.png",
      "elevations/user/a.png",
      "thumbs/renders/r1.png.webp",
      "thumbs/elevations/user/a.png.webp",
      "stock/exterior/a.jpg",
      "feedback/f1.png",
      // Look-alikes: wrong version marker, not render output, nested paths, missing extension.
      "watermarked-vx/renders/r1.png",
      "watermarked/elevations/user/a.png",
      "watermarked-v2/renders/sub/r1.png",
      "thumbs/watermarked-v2/renders/r1.png",
      "xwatermarked/renders/r1.png",
    ]) {
      expect(obsoleteWatermarkVersion(key, 3), key).toBeNull();
    }
  });

  it("lists only watermark prefixes to scan", () => {
    for (const prefix of WATERMARK_DERIVED_PREFIXES) expect(prefix).toMatch(/^(thumbs\/)?watermarked/);
  });

  it("waits eight days after the current version first stored a copy", () => {
    expect(cleanupAllowedFrom(new Date("2026-10-20T00:00:00Z")).toISOString()).toBe("2026-10-28T00:00:00.000Z");
  });
});
