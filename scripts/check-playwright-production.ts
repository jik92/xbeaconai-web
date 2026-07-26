import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true,
  timeout: 30_000,
  args: process.platform === "linux" ? ["--no-sandbox", "--disable-setuid-sandbox"] : [],
});

try {
  const page = await browser.newPage();
  await page.setContent("<title>playwright-production-check</title><main>ok</main>", { timeout: 10_000 });
  if ((await page.title()) !== "playwright-production-check" || (await page.locator("main").textContent()) !== "ok")
    throw new Error("Playwright Chromium 启动成功但页面渲染检查失败");
  console.log(`Playwright production check passed: Chromium ${browser.version()}`);
} finally {
  await browser.close();
}
