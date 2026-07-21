import { expect, test } from "@playwright/test";
import { registerFromAuthScreen } from "./auth-helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/aigc/ad-script");
  if (
    await page
      .getByRole("button", { name: "注册", exact: true })
      .isVisible()
      .catch(() => false)
  ) {
    await registerFromAuthScreen(page, "口播脚本测试用户", "AdScript2026");
    await page.goto("/aigc/ad-script");
  }
});

test("configures a real ad-script workflow across all three steps", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "口播脚本" })).toBeVisible();
  await expect(page.getByText("deepseek/deepseek-v4-pro")).toBeVisible();
  await page.getByRole("button", { name: /本地到店/ }).click();
  await page.getByRole("button", { name: "下一步" }).click();

  await page.getByLabel(/产品名称/).fill("轻盈咖啡");
  await page.getByLabel(/产品卖点/).fill("现磨咖啡豆\n到店可领取试饮");
  await page.getByLabel(/目标用户/).fill("附近写字楼的上班族");
  await page.getByRole("button", { name: "下一步" }).click();

  await page.getByRole("button", { name: /普通用户/ }).click();
  await page.getByRole("button", { name: "情绪共鸣" }).click();
  await expect(page.getByText("将生成 1 条差异化脚本")).toBeVisible();
  await page.getByRole("button", { name: /生成脚本 · 20 创作点/ }).click();
  await expect(page.getByRole("heading", { name: "AI 智能调优中" })).toBeVisible();
  await expect(page.getByText(/已耗时 \d+ 秒 · 目标 1 分钟内完成/)).toBeVisible();
  await expect(page.locator(".ad-script-feedback.error")).toHaveCount(0);
});

test("keeps the scene and role grids usable at configured viewports", async ({ page }) => {
  await expect(page.locator(".scene-grid > button")).toHaveCount(8);
  await expect(page.locator(".ad-script-card")).toBeInViewport();
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByLabel(/产品名称/).fill("便携榨汁杯");
  await page.getByLabel(/产品卖点/).fill("轻巧便携");
  await page.getByLabel(/目标用户/).fill("租房上班族");
  await page.getByRole("button", { name: "下一步" }).click();
  await expect(page.locator(".role-grid > button")).toHaveCount(6);
  await expect(page.locator(".result-actions")).toHaveCount(0);
});
