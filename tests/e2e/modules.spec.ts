import { expect, test } from "@playwright/test";
import { modules } from "../../src/app/routes";

for (const module of modules) {
  test(`${module.label} exposes its complete business workflow`, async ({ page }) => {
    await page.goto(module.path);
    await expect(page.getByRole("heading", { name: module.label, exact: true })).toBeVisible();
    for (const step of module.steps) await expect(page.locator(".steps").getByText(step)).toBeVisible();
    for (const field of module.fields) await expect(page.locator(".field > label").filter({ hasText: field.label }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: module.action })).toBeVisible();
    await expect(page.getByText(`预计消耗 ${module.cost} 创作点`)).toBeVisible();
  });
}

test("required field validation blocks an incomplete task", async ({ page }) => {
  await page.goto("/aigc/ad-script");
  await page.getByRole("button", { name: "生成 3 版脚本" }).click();
  await expect(page.getByText("请完成此项后再提交")).toHaveCount(4);
  await expect(page.getByText("还没有创作记录")).toBeVisible();
});

test("navigation keeps all twelve modules reachable", async ({ page }) => {
  await page.goto("/");
  for (const module of modules) await expect(page.getByRole("link", { name: new RegExp(module.label) })).toBeVisible();
});

test("口播脚本 completes from validated brief to result preview", async ({ page }) => {
  await page.goto("/aigc/ad-script");
  await page.locator("#product").fill("便携榨汁杯");
  await page.locator("#sellingPoints").fill("轻巧随身\n30 秒出汁\n低噪清洗方便");
  await page.locator("#audience").fill("独居上班族");
  await page.locator("#framework").selectOption({ label: "痛点—方案—证据—行动" });
  await page.getByRole("button", { name: "生成 3 版脚本" }).click();
  await expect(page.getByText("已完成", { exact: true })).toBeVisible({ timeout: 8_000 });
  await page.getByRole("button", { name: "查看结果" }).click();
  await expect(page.getByRole("heading", { name: "口播脚本", level: 2 })).toBeVisible();
  await expect(page.getByRole("button", { name: "一键成片" })).toBeVisible();
});

test("active tasks can be cancelled and retried", async ({ page }) => {
  await page.goto("/aigc/ad-script");
  await page.locator("#product").fill("演示商品");
  await page.locator("#sellingPoints").fill("核心卖点");
  await page.locator("#audience").fill("目标用户");
  await page.locator("#framework").selectOption({ index: 1 });
  await page.getByRole("button", { name: "生成 3 版脚本" }).click();
  await page.getByRole("button", { name: "取消" }).click();
  await expect(page.getByText("已取消", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "重试" })).toBeVisible();
});
