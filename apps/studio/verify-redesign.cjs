const { chromium } = require("@playwright/test");

(async () => {
  const browser = await chromium.launch();
  const outDir = "C:/Users/ADMIN/AppData/Local/Temp/claude/f--PROJECTS-Renvia/40936e75-ebad-49f4-a5cc-857e5740c6e4/scratchpad";
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto("http://localhost:3000/", { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(500);

  const height = await page.evaluate(() => document.body.scrollHeight);
  console.log("page height:", height);

  await page.screenshot({ path: outDir + "/redesign-hero.png" });

  const steps = 5;
  for (let i = 1; i <= steps; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), (height / steps) * i);
    await page.waitForTimeout(300);
    await page.screenshot({ path: outDir + "/redesign-scroll-" + i + ".png" });
  }

  await browser.close();
  console.log("DONE");
})();
