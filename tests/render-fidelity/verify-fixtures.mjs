import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../..");
const manifest = JSON.parse(await readFile(resolve(testDirectory, "manifest.json"), "utf8"));

const fixtures = [manifest.source];
for (const testCase of manifest.cases) fixtures.push(...testCase.referenceImages);
fixtures.push(...manifest.legacyRenderedResults);

let failures = 0;
for (const fixture of fixtures) {
  const path = resolve(repositoryRoot, fixture.path);
  try {
    await stat(path);
    const digest = createHash("sha256").update(await readFile(path)).digest("hex").toUpperCase();
    if (digest !== fixture.sha256) throw new Error(`checksum differs (expected ${fixture.sha256}, got ${digest})`);
    console.log(`PASS ${fixture.path}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${fixture.path}: ${error.message}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} visual-regression fixture${failures === 1 ? "" : "s"} failed verification.`);
  process.exit(1);
}

console.log(`\n${fixtures.length} visual-regression fixtures verified.`);
