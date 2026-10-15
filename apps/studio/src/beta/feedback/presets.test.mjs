import assert from "node:assert/strict";
import test from "node:test";
import { categoriesFor, isProblem, KINDS, reportableRenders } from "./presets.ts";

test("every kind has categories, and ideas and praise aren't problems", () => {
  for (const kind of KINDS) assert.ok(categoriesFor(kind.value).length > 0);
  assert.equal(categoriesFor("visual_quality")[0], "architecture_changed");
  assert.equal(isProblem("bug"), true);
  assert.equal(isProblem("suggestion"), false);
  assert.equal(isProblem("praise"), false);
});

test("only finished or failed renders can be attached, newest first", () => {
  const job = (id, status, createdAt, resultImageUrl = null) => ({ id, status, createdAt, resultImageUrl, sourceImageUrl: "src.jpg" });
  const jobs = [
    job("old", "succeeded", "2026-10-01T00:00:00Z", "a.jpg"),
    job("running", "processing", "2026-10-05T00:00:00Z"),
    job("broken", "failed", "2026-10-03T00:00:00Z"),
    job("new", "succeeded", "2026-10-04T00:00:00Z", "b.jpg"),
    job("no-image", "succeeded", "2026-10-06T00:00:00Z"),
  ];
  assert.deepEqual(reportableRenders(jobs).map((item) => item.id), ["new", "broken", "old"]);
  assert.deepEqual(reportableRenders(jobs, 1).map((item) => item.id), ["new"]);
});
