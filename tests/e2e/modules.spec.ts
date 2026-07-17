import { expect, test, type Page } from "@playwright/test";
import { modules } from "../../src/app/routes";

async function completeField(page: Page, field: (typeof modules)[number]["fields"][number]) {
  if (!field.required) return;
  if (["video", "audio", "image"].includes(field.kind)) {
    await page.locator(`#${field.id}`).setInputFiles({ name: `${field.id}.mp4`, mimeType: field.kind === "audio" ? "audio/mpeg" : "video/mp4", buffer: Buffer.from("mock") });
  } else if (field.kind === "asset-group" || field.kind === "region" || field.kind === "checkbox") {
    await page.locator(`#${field.id}`).click();
  } else if (field.kind === "select") {
    await page.locator(`#${field.id}`).selectOption({ index: 1 });
  } else if (field.kind === "text" || field.kind === "textarea") {
    await page.locator(`#${field.id}`).fill(`测试${field.label}`);
  }
}

for (const module of modules) {
  if (module.id === "video-remix") continue;
  test(`${module.label} exposes its complete business workflow`, async ({ page }) => {
    await page.goto(module.path);
    await expect(page.getByRole("heading", { name: module.label, exact: true })).toBeVisible();
    for (const step of module.steps) await expect(page.locator(".steps").getByText(step)).toBeVisible();
    const splitAt = Math.ceil(module.fields.length / 2);
    for (const field of module.fields.slice(0, splitAt)) { await expect(page.locator(".field > label").filter({ hasText: field.label }).first()).toBeVisible(); await completeField(page, field); }
    await page.getByRole("button", { name: "下一步" }).click();
    for (const field of module.fields.slice(splitAt)) { await expect(page.locator(".field > label").filter({ hasText: field.label }).first()).toBeVisible(); await completeField(page, field); }
    await page.getByRole("button", { name: "下一步" }).click();
    await expect(page.getByRole("heading", { name: "确认创作配置" })).toBeVisible();
    await expect(page.getByRole("button", { name: module.action })).toBeVisible();
    await expect(page.getByText(`预计消耗 ${module.cost} 创作点`)).toBeVisible();
  });
}

test("爆款二创 provides the five-stage project workflow", async ({ page }) => {
  await page.goto("/aigc/video-remix");
  for (const step of ["上传配置", "AI 解析", "提示词校对", "分镜校对", "合并成片"]) await expect(page.locator(".project-steps").getByRole("button", { name: new RegExp(step) })).toBeVisible();
  await page.getByRole("button", { name: "下一步" }).click();
  await expect(page.getByRole("heading", { name: "准备进行 AI 解析" })).toBeVisible();
  await page.getByRole("button", { name: "开始 AI 解析" }).click();
  await expect(page.getByText("13428656243498662.mp4")).toBeVisible({ timeout: 3_000 });
  await page.getByRole("button", { name: "编辑文本" }).click();
  await expect(page.locator(".prompt-paper textarea")).toBeVisible();
  await page.getByRole("button", { name: "下一步" }).click();
  await expect(page.getByRole("heading", { name: "逐镜确认画面与口播" })).toBeVisible();
  await page.locator(".project-footer").getByRole("button", { name: "下一步" }).click();
  await expect(page.getByRole("heading", { name: "确认合并成片" })).toBeVisible();
});

test("required field validation blocks an incomplete task", async ({ page }) => {
  await page.goto("/aigc/ad-script");
  await page.getByRole("button", { name: "下一步" }).click();
  await expect(page.getByText("请完成此项后再提交")).toHaveCount(3);
  await expect(page.getByText("还没有创作记录")).toBeVisible();
});

test("navigation keeps all twelve modules reachable", async ({ page }) => {
  await page.goto("/aigc/video-create");
  for (const module of modules) await expect(page.getByRole("link", { name: new RegExp(module.label) })).toBeVisible();
});

test("口播脚本 completes from validated brief to result preview", async ({ page }) => {
  await page.goto("/aigc/ad-script");
  await page.locator("#product").fill("便携榨汁杯");
  await page.locator("#sellingPoints").fill("轻巧随身\n30 秒出汁\n低噪清洗方便");
  await page.locator("#audience").fill("独居上班族");
  await page.getByRole("button", { name: "下一步" }).click();
  await page.locator("#framework").selectOption({ label: "痛点—方案—证据—行动" });
  await page.getByRole("button", { name: "下一步" }).click();
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
  await page.getByRole("button", { name: "下一步" }).click();
  await page.locator("#framework").selectOption({ index: 1 });
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByRole("button", { name: "生成 3 版脚本" }).click();
  await page.getByRole("button", { name: "取消" }).click();
  await expect(page.getByText("已取消", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "重试" })).toBeVisible();
});
