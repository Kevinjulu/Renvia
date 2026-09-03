const { chromium } = require("@playwright/test");
const path = require("path");
const OUT_DIR = "C:\\Users\\ADMIN\\AppData\\Local\\Temp\\claude\\f--PROJECTS-Renvia\\5103b820-bfad-4c1b-a462-a7dd22e31312\\scratchpad";

async function findSection(page) {
  await page.waitForSelector("text=Renvia Studio", { timeout: 10000, state: "attached" });
  return page.evaluate(() => {
    const heading = [...document.querySelectorAll("p")].find((p) => p.textContent?.trim() === "Renvia Studio");
    const section = heading?.closest("section");
    if (!section) return null;
    const rect = section.getBoundingClientRect();
    return { top: rect.top + window.scrollY, height: rect.height };
  });
}

(async () => {
  const browser = await chromium.launch();

  const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
  await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
  const box = await findSection(page);
  if (!box) throw new Error("section not found (desktop)");
  await page.evaluate((y) => window.scrollTo(0, y), box.top);
  await page.waitForTimeout(700);
  const scrollY = await page.evaluate(() => window.scrollY);
  await page.screenshot({
    path: path.join(OUT_DIR, "studio-showcase-new.png"),
    clip: { x: 0, y: box.top - scrollY, width: 1440, height: box.height },
  });
  console.log("desktop saved");

  const mobile = await browser.newPage({ viewport: { width: 390, height: 2200 } });
  await mobile.goto("http://localhost:3000/", { waitUntil: "networkidle" });
  const mbox = await findSection(mobile);
  if (!mbox) throw new Error("section not found (mobile)");
  await mobile.evaluate((y) => window.scrollTo(0, y), mbox.top);
  await mobile.waitForTimeout(700);
  const mScrollY = await mobile.evaluate(() => window.scrollY);
  await mobile.screenshot({
    path: path.join(OUT_DIR, "studio-showcase-new-mobile.png"),
    clip: { x: 0, y: mbox.top - mScrollY, width: 390, height: Math.min(mbox.height, 2200) },
  });
  console.log("mobile saved");

  await browser.close();
})();
