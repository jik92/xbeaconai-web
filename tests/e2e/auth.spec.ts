import { expect, test } from "@playwright/test";
import { E2E_SMS_CODE, randomPhone } from "./auth-helpers";

test("registers with only phone and SMS before setting a password", async ({ page }) => {
  const phone = randomPhone();
  await page.goto("/");
  await page.getByRole("button", { name: "注册", exact: true }).click();

  await expect(page.getByLabel("手机号")).toBeVisible();
  await expect(page.getByLabel("短信验证码")).toBeVisible();
  await expect(page.getByLabel("显示名称")).toHaveCount(0);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);

  await page.getByLabel("手机号").fill(phone);
  await page.getByRole("button", { name: "获取验证码" }).click();
  await expect(page.getByRole("status")).toHaveText(`当前验证码：${E2E_SMS_CODE}`);
  await page.getByLabel("短信验证码").fill(E2E_SMS_CODE);
  await page.getByRole("button", { name: "验证并注册" }).click();

  await expect(page.getByText("手机号验证成功，账号已注册，请设置登录密码")).toBeVisible();
  await page.getByLabel("新密码").fill("AuthFlow2026");
  await page.getByLabel("确认密码").fill("AuthFlow2026");
  await page.getByRole("button", { name: "设置密码并登录" }).click();
  await expect(page.locator(".auth-page")).toBeHidden();
});

test("recovers a pending account through forgot password", async ({ page, request }) => {
  const phone = randomPhone();
  const codeResponse = await request.post("/api/auth/sms-code", { data: { phone, purpose: "register" } });
  expect(codeResponse.status()).toBe(200);
  expect(await codeResponse.json()).toMatchObject({ verificationCode: E2E_SMS_CODE });
  const registration = await request.post("/api/auth/register", {
    data: { phone, verificationCode: E2E_SMS_CODE },
  });
  expect(registration.status()).toBe(201);

  await page.goto("/");
  await page.getByRole("button", { name: "忘记密码？" }).click();
  await page.getByLabel("手机号").fill(phone);
  await page.getByRole("button", { name: "获取验证码" }).click();
  await expect(page.getByRole("status")).toHaveText(`当前验证码：${E2E_SMS_CODE}`);
  await page.getByLabel("短信验证码").fill(E2E_SMS_CODE);
  await page.getByRole("button", { name: "验证手机号" }).click();
  await expect(page.getByText("手机号验证成功，请设置新的登录密码")).toBeVisible();
  await page.getByLabel("新密码").fill("Recovered2026");
  await page.getByLabel("确认密码").fill("Recovered2026");
  await page.getByRole("button", { name: "设置密码并登录" }).click();
  await expect(page.locator(".auth-page")).toBeHidden();
});
