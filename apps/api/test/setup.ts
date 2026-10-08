import { afterAll, beforeEach } from "vitest";
import { assertLocalDatabase, TEST_DATABASE_URL } from "./support/config.js";
import { closePool, installNeonShim } from "./support/neonShim.js";
import { resetDb } from "./support/db.js";

assertLocalDatabase(TEST_DATABASE_URL);
installNeonShim(TEST_DATABASE_URL);

beforeEach(resetDb);
afterAll(closePool);
