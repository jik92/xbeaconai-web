import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }, testInfo) => {
  await page.goto("/aigc/video-create");
  if (
    await page
      .getByRole("button", { name: "注册", exact: true })
      .isVisible()
      .catch(() => false)
  ) {
    await page.getByRole("button", { name: "注册", exact: true }).click();
    await page.getByLabel("显示名称").fill("一键成片测试用户");
    await page.getByLabel("邮箱").fill(`video-create-${testInfo.project.name}-${crypto.randomUUID()}@example.test`);
    await page.locator('input[type="password"]').fill("VideoCreate2026");
    await page.getByRole("button", { name: "创建账号并登录" }).click();
    await expect(page.locator(".auth-page")).toBeHidden();
    await page.goto("/aigc/video-create");
  }
});

test("opens the dedicated two-column video create workbench", async ({ page }) => {
  await expect(page.locator(".video-create-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "新建项目" })).toBeVisible();
  await expect(page.getByRole("button", { name: /AI 填充参数/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /脚本/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /分镜/ }).first()).toBeVisible();
  await expect(page.getByText("产出物将在这里呈现")).toBeVisible();
  await expect(page.locator(".vc-config-panel")).toBeInViewport();
  await expect(page.locator(".vc-output-panel")).toBeInViewport();
});

test("edits the complete parameter panels and opens recoverable history", async ({ page }) => {
  await page.getByRole("button", { name: "短视频带货" }).click();
  await page.getByText("视频时长").locator("..").getByRole("button", { name: "30s" }).click();
  await page.getByText("分镜段数").locator("..").getByRole("button", { name: "＋" }).click();
  await page.getByRole("button", { name: /广告诉求/ }).click();
  await page.getByRole("button", { name: "电商转化", exact: true }).click();
  await page.getByRole("button", { name: "职场白领", exact: true }).click();
  await expect(page.getByRole("button", { name: /广告诉求 2 已选/ })).toBeVisible();
  await page.getByPlaceholder("例：夏天防晒产品总是厚重泛白").fill("通勤衬衫容易闷热");
  await page.getByRole("button", { name: /脚本风格/ }).click();
  await page.getByRole("button", { name: "好物推荐员", exact: true }).click();
  await page.getByRole("button", { name: "痛点直击", exact: true }).click();
  await expect(page.getByRole("button", { name: /脚本风格 2 已选/ })).toBeVisible();
  await page.getByRole("button", { name: /高级设置/ }).click();
  await page.getByRole("button", { name: "场景展示", exact: true }).click();
  await expect(page.getByText("视频模型")).toBeVisible();
  await page.getByRole("button", { name: /生成记录/ }).click();
  await expect(page.getByRole("heading", { name: "生成记录" })).toBeVisible();
  await expect(page.getByText("暂无生成记录")).toBeVisible();
});
