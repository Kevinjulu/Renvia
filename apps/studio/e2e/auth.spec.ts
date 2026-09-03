import { test, expect } from "@playwright/test";
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { getSql } from "./db";

test.describe("unauthenticated redirects", () => {
  test("dashboard redirects to /login when signed out", async ({ page }) => {
    await page.goto("/dashboard");
    // Clerk's SDK loads async on first navigation; ProtectedRoute waits for isLoaded.
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });

  test("canvas route redirects to /login when signed out", async ({ page }) => {
    await page.goto("/project/test-project-id");
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });
});

test.describe("sign-up flow", () => {
  test("completes real sign-up, syncs user to Postgres, and /me returns it", async ({ page }) => {
    await setupClerkTestingToken({ page });

    const testEmail = `e2e+clerk_test+${Date.now()}@example.com`;
    const sql = getSql();

    await page.goto("/signup");

    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel("Password", { exact: true }).fill("Test-Password-12345!");

    await page.getByRole("button", { name: "Continue", exact: true }).click();

    // Custom two-step signup renders the code field in place (no Clerk-internal sub-route navigation).
    await expect(page.getByText(/check your email/i)).toBeVisible({ timeout: 15_000 });
    await page.getByLabel(/verification code/i).fill("424242");
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

    const token = await page.evaluate(async () => {
      const clerk = (window as unknown as { Clerk?: { session?: { getToken(): Promise<string | null> } } }).Clerk;
      return clerk?.session?.getToken();
    });
    expect(token).toBeTruthy();

    const meResponse = await page.request.get("http://localhost:8787/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(meResponse.ok()).toBe(true);
    const me = await meResponse.json();
    expect(me.email).toBe(testEmail);

    const rows = await sql`select id, clerk_id, email from users where email = ${testEmail}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].clerk_id).toBe(me.clerkId);
  });
});
