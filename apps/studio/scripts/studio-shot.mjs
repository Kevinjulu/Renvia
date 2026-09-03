import { chromium } from "@playwright/test";
import { clerkSetup, setupClerkTestingToken } from "@clerk/testing/playwright";

await clerkSetup();

const browser = await chromium.launch({
  executablePath: "C:\\Users\\ADMIN\\AppData\\Local\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe",
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

await setupClerkTestingToken({ page });

const testEmail = `e2e+clerk_test+${Date.now()}@example.com`;
console.log("goto signup");
await page.goto("http://localhost:5173/signup");
console.log("waiting for email field");
await page.getByLabel(/email/i).waitFor({ state: "visible", timeout: 20000 });
await page.screenshot({ path: process.argv[4] });
console.log("filling form");

await page.getByLabel(/email/i).fill(testEmail);
await page.getByLabel("Password", { exact: true }).fill("Test-Password-12345!");
await page.getByRole("button", { name: "Continue", exact: true }).click();
console.log("submitted signup");

await page.waitForURL(/verify-email-address/, { timeout: 15000 });
const codeInput = page.locator("input").first();
await codeInput.waitFor({ state: "visible", timeout: 15000 });
await codeInput.fill("424242");

const verifyButton = page.getByRole("button", { name: "Continue", exact: true });
if (await verifyButton.isVisible().catch(() => false)) {
  await verifyButton.click();
}

await page.waitForURL(/\/dashboard/, { timeout: 20000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: process.argv[2] });

await page.getByRole("button", { name: /new project/i }).click();
await page.waitForURL(/\/project\//, { timeout: 15000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: process.argv[3] });

await browser.close();
console.log("done");
