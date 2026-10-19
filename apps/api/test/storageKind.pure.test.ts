import { describe, expect, it } from "vitest";
import { storageKindFor } from "../src/lib/storage.js";

describe("storageKindFor", () => {
  it("counts every stored watermark copy as a watermark, whatever its version", () => {
    expect(storageKindFor("watermarked/renders/r1.png")).toBe("watermark");
    expect(storageKindFor("watermarked-v2/renders/r1.png")).toBe("watermark");
    expect(storageKindFor("watermarked-v3/renders/r1-selection.png")).toBe("watermark");
  });

  it("keeps the other kinds", () => {
    expect(storageKindFor("renders/r1.png")).toBe("render");
    expect(storageKindFor("elevations/user/a.png")).toBe("upload");
    expect(storageKindFor("thumbs/watermarked/renders/r1.png.webp")).toBe("thumbnail");
    expect(storageKindFor("thumbs/renders/r1.png.webp")).toBe("thumbnail");
    expect(storageKindFor("feedback/x.png")).toBe("feedback");
    expect(storageKindFor("stock/x.png")).toBe("stock");
    // Only the versioned copy prefix, not anything that merely starts with "watermarked".
    expect(storageKindFor("watermarked-vx/renders/r1.png")).toBe("upload");
  });
});
