import { eq } from "drizzle-orm";
import { schema } from "@renvia/db";
import { describe, expect, it, vi } from "vitest";
import { callApi } from "./support/api.js";
import { db, makeProject, makeRender, makeUser } from "./support/db.js";

// A render request retried after a timeout must return the render the first attempt created,
// never charge for a second one.
vi.mock("@clerk/backend", async () => (await import("./support/clerkStub.js")).clerkStub());

/** The starter plan allows one render in flight; tests that queue several raise it. */
async function setup(concurrentRenderLimit?: number) {
  await db.insert(schema.billingPlans).values({ slug: "starter", name: "Starter", description: "Starter plan", concurrentRenderLimit });
  const user = await makeUser({ clerkId: "customer", email: "customer@example.test", creditBalance: 10 });
  const project = await makeProject(user.id);
  return { user, project };
}

function queue(projectId: string, idempotencyKey?: string) {
  return callApi("customer", "POST", "/renders", {
    projectId,
    sourceImageUrl: "https://example.test/elevation.jpg",
    prompt: "",
    aspectRatio: "auto",
    style: "Photorealistic",
    // Given up front so the request needn't read the image to detect it.
    generationSettings: { sourceType: "photo" },
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });
}

const balance = async (id: string) => (await db.select().from(schema.users).where(eq(schema.users.id, id)))[0]!.creditBalance;
const renderCount = async (projectId: string) => (await db.select().from(schema.renders).where(eq(schema.renders.projectId, projectId))).length;
const jobOf = async (response: Response) => ((await response.json()) as { job: { id: string }; replayed?: boolean });

describe("render idempotency", () => {
  it("returns the first render for a repeat of the same key, charging once", async () => {
    const { user, project } = await setup();
    const key = crypto.randomUUID();

    const first = await queue(project.id, key);
    expect(first.status).toBe(201);
    const repeat = await queue(project.id, key);
    expect(repeat.status).toBe(200);

    const [a, b] = [await jobOf(first), await jobOf(repeat)];
    expect(b.job.id).toBe(a.job.id);
    expect(b.replayed).toBe(true);
    expect(await renderCount(project.id)).toBe(1);
    expect(await balance(user.id)).toBe(9);
  });

  // With one render allowed in flight, the losing attempt also meets the concurrency limit the
  // winner's render now fills; it must still get that render back, not a refusal.
  it("charges once when two attempts of the same request race", async () => {
    const { user, project } = await setup();
    const key = crypto.randomUUID();

    const responses = await Promise.all([queue(project.id, key), queue(project.id, key)]);
    const ids = await Promise.all(responses.map(async (response) => (await jobOf(response)).job.id));
    expect(ids[0]).toBe(ids[1]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    expect(await renderCount(project.id)).toBe(1);
    expect(await balance(user.id)).toBe(9);
  });

  it("treats different keys, or no key, as separate renders", async () => {
    const { user, project } = await setup(10);
    expect((await queue(project.id, crypto.randomUUID())).status).toBe(201);
    expect((await queue(project.id, crypto.randomUUID())).status).toBe(201);
    expect((await queue(project.id)).status).toBe(201);
    expect((await queue(project.id)).status).toBe(201);
    expect(await renderCount(project.id)).toBe(4);
    expect(await balance(user.id)).toBe(6);
  });

  it("scopes a key to its project", async () => {
    const { user, project } = await setup(10);
    const other = await makeProject(user.id);
    const key = crypto.randomUUID();
    const first = await jobOf(await queue(project.id, key));
    const elsewhere = await queue(other.id, key);
    expect(elsewhere.status).toBe(201);
    expect((await jobOf(elsewhere)).job.id).not.toBe(first.job.id);
  });

  it("returns the first export for a repeat of the same key, charging once", async () => {
    const { user, project } = await setup();
    const parent = await makeRender(project.id, { status: "succeeded", resultImageUrl: "http://localhost/api/uploads/renders/parent.jpg" });
    const key = crypto.randomUUID();
    const exportOnce = () => callApi("customer", "POST", `/renders/${parent.id}/upscale`, { target: "4k", idempotencyKey: key });

    const first = await exportOnce();
    expect(first.status).toBe(201);
    const repeat = await exportOnce();
    expect(repeat.status).toBe(200);
    expect((await jobOf(repeat)).job.id).toBe((await jobOf(first)).job.id);
    expect(await renderCount(project.id)).toBe(2);
    expect(await balance(user.id)).toBe(9);
  });

  it("refuses a key that isn't a UUID", async () => {
    const { project } = await setup();
    expect((await queue(project.id, "not-a-uuid")).status).toBe(400);
  });
});
