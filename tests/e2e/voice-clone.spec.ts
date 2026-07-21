import { expect, test } from "@playwright/test";
import { registerFromAuthScreen } from "./auth-helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/tools/voice-clone");
  if (
    await page
      .getByRole("button", { name: "注册", exact: true })
      .isVisible()
      .catch(() => false)
  ) {
    await registerFromAuthScreen(page, "音色测试用户", "VoiceTest2026");
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
