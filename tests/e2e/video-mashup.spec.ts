import { expect, test } from "@playwright/test";
import { registerFromAuthScreen } from "./auth-helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/tools/video-mashup");
  if (
    await page
      .getByRole("button", { name: "注册", exact: true })
      .isVisible()
      .catch(() => false)
  ) {
    await registerFromAuthScreen(page, "混剪测试用户", "MashupTest2026");
    await page.goto("/tools/video-mashup");
  }
});

test("manages video groups and shows a live combination summary", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "视频混剪" })).toBeVisible();
  await page.getByRole("button", { name: "新建混剪任务" }).click();
  const creator = page.getByRole("dialog", { name: "新建混剪任务" });
  await expect(creator).toBeVisible();
  await expect(creator.getByLabel("视频组 1 名称")).toHaveValue("视频组-1");
  await expect(creator.getByLabel("视频组 2 名称")).toHaveValue("视频组-2");
  await expect(creator.getByText("理论组合")).toBeVisible();
  await expect(creator.getByText("预计生成")).toBeVisible();
  await creator.getByRole("button", { name: "添加视频组" }).click();
  await expect(creator.getByLabel("视频组 3 名称")).toBeVisible();
  await creator.getByRole("button", { name: "创建 0 个混剪成片" }).click();
  await expect(creator.getByText("必须选择 1–20 个视频")).toBeVisible();
});
