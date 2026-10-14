import { describe, expect, it } from "vitest";
import { selectionPlacement } from "../src/lib/composite.js";

// Pure geometry: no database (setup.ts skips the reset for *.pure.test.ts files).

const frame = { left: 0, top: 0, width: 900, height: 600 };

describe("selectionPlacement", () => {
  it("names the centre", () => {
    expect(selectionPlacement({ left: 400, top: 250, width: 100, height: 100 }, frame)).toBe("in the centre");
  });

  it("names corners and edges", () => {
    expect(selectionPlacement({ left: 20, top: 20, width: 100, height: 80 }, frame)).toBe("in the upper left");
    expect(selectionPlacement({ left: 760, top: 480, width: 100, height: 80 }, frame)).toBe("in the lower right");
    expect(selectionPlacement({ left: 400, top: 10, width: 100, height: 60 }, frame)).toBe("at the top");
    expect(selectionPlacement({ left: 20, top: 260, width: 100, height: 80 }, frame)).toBe("on the left");
  });

  it("measures against the crop the model is given, not the whole image", () => {
    const crop = { left: 1000, top: 500, width: 300, height: 300 };
    expect(selectionPlacement({ left: 1100, top: 600, width: 100, height: 100 }, crop)).toBe("in the centre");
  });

  it("gives no position when the selection fills most of the frame", () => {
    expect(selectionPlacement({ left: 50, top: 50, width: 800, height: 500 }, frame)).toBeNull();
  });
});
