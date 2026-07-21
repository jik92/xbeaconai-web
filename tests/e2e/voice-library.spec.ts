import { expect, test } from "@playwright/test";

function wavFixture() {
  const sampleRate = 8_000;
  const sampleCount = 800;
  const bytes = Buffer.alloc(44 + sampleCount * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(sampleCount * 2, 40);
  return bytes;
}

test.beforeEach(async ({ page }, testInfo) => {
  await page.goto("/assets/voices");
  if (
    await page
      .getByRole("button", { name: "注册", exact: true })
      .isVisible()
      .catch(() => false)
  ) {
    await page.getByRole("button", { name: "注册", exact: true }).click();
    await page.getByLabel("显示名称").fill("音色库测试用户");
    await page.getByLabel("邮箱").fill(`voice-library-${testInfo.project.name}-${crypto.randomUUID()}@example.test`);
    await page.locator('input[type="password"]').fill("VoiceTest2026");
    await page.getByRole("button", { name: "创建账号并登录" }).click();
    await expect(page.locator(".auth-page")).toBeHidden();
    await page.goto("/assets/voices");
  }
});

test("plays an uploaded voice from the card and detail dialog", async ({ page }) => {
  await page.getByRole("button", { name: "上传音色" }).click();
  await page.locator('.asset-upload-modal input[type="file"]').setInputFiles({
    name: "voice-preview.wav",
    mimeType: "audio/wav",
    buffer: wavFixture(),
  });
  await page.getByRole("button", { name: "确认上传" }).click();

  const detail = page.locator(".asset-detail-modal");
  await expect(detail).toBeVisible();
  await expect(detail.locator("audio[controls]")).toBeVisible();
  await detail.getByRole("button", { name: "关闭" }).click();

  await page.getByRole("button", { name: "试听音色" }).click();
  await expect(page.locator(".voice-asset-card audio[controls]")).toBeVisible();

  await page.locator(".voice-asset-details").click();
  await expect(detail).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await detail.getByRole("button", { name: "删除音色" }).click();
  await expect(detail).toBeHidden();
  await expect(page.locator(".voice-asset-card")).toHaveCount(0);
});
