import root from "../../src/index.js";
import { adminEnv } from "./admin.js";

/** Calls the real app at /api<path>, signed in as the user with this Clerk id (see clerkStub). */
export function callApi(clerkId: string | null, method: string, path: string, body?: unknown) {
  return root.request(
    `http://localhost/api${path}`,
    {
      method,
      headers: {
        ...(clerkId ? { Authorization: `Bearer ${clerkId}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    adminEnv,
  );
}
