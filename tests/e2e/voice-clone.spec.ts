import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }, testInfo) => {
  await page.goto("/tools/voice-clone");
  if (
    await page
      .getByRole("button", { name: "注册", exact: true })
      .isVisible()
      .catch(() => false)
  ) {
    await page.getByRole("button", { name: "注册", exact: true }).click();
    await page.getByLabel("显示名称").fill("音色测试用户");
    await page.getByLabel("邮箱").fill(`voice-${testInfo.project.name}-${crypto.randomUUID()}@example.test`);
    await page.locator('input[type="password"]').fill("VoiceTest2026");
    await page.getByRole("button", { name: "创建账号并登录" }).click();
    await expect(page.locator(".auth-page")).toBeHidden();
    await page.goto("/tools/voice-clone");
  }
});

test("shows only the preset text-to-speech flow", async ({ page }) => {
  await page.locator(".task-toolbar .new-task-button").click();
  const form = page.locator(".voice-clone-form");
  await expect(form.getByText("任务类型：")).toHaveCount(0);
  await expect(form.getByRole("button", { name: "克隆新音色" })).toHaveCount(0);
  await expect(form.getByText("原始音频：")).toHaveCount(0);
  await expect(form.getByText("任务名称：")).toHaveCount(0);
  await expect(form.getByText("费用确认：")).toHaveCount(0);
  await expect(form.getByText("系统预设音色")).toBeVisible();
  await expect(form.getByText("合成文本：")).toBeVisible();
  await expect(form.getByText("语言：")).toBeVisible();
  await expect(form.getByText("配音风格：")).toBeVisible();
  await expect(form.getByText("语速：")).toBeVisible();
  await expect(form.getByRole("slider", { name: "语速" })).toBeVisible();
});
