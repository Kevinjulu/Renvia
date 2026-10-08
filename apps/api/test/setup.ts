import { afterAll, beforeEach, expect } from "vitest";
import { assertLocalDatabase, TEST_DATABASE_URL } from "./support/config.js";
import { closePool, installNeonShim } from "./support/neonShim.js";
import { resetDb } from "./support/db.js";

assertLocalDatabase(TEST_DATABASE_URL);
installNeonShim(TEST_DATABASE_URL);

// Image-only tests (*.pure.test.ts) never touch the database, so they skip the reset.
beforeEach(async () => {
  if (!expect.getState().testPath?.endsWith(".pure.test.ts")) await resetDb();
});
afterAll(closePool);
