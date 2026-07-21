import { type APIRequestContext, expect, type Page } from "@playwright/test";

export const E2E_SMS_CODE = "246810";

export function randomPhone() {
  const [randomValue = 0] = crypto.getRandomValues(new Uint32Array(1));
  const suffix = randomValue % 1_000_000_000;
  return `18${suffix.toString().padStart(9, "0")}`;
}

export async function registerFromAuthScreen(page: Page, displayName: string, password: string) {
  const phone = randomPhone();
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.getByLabel("显示名称").fill(displayName);
  await page.getByLabel("手机号").fill(phone);
  await page.getByRole("button", { name: "获取验证码" }).click();
  await expect(page.getByText("验证码已发送，请查看服务端日志")).toBeVisible();
  await page.getByLabel("短信验证码").fill(E2E_SMS_CODE);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "创建账号并登录" }).click();
  await expect(page.locator(".auth-page")).toBeHidden();
  return phone;
}

export async function authenticate(request: APIRequestContext, phone: string, password: string, displayName: string) {
  let response = await request.post("/api/auth/login", { data: { phone, password } });
  if (response.status() === 401) {
    const codeResponse = await request.post("/api/auth/sms-code", { data: { phone } });
    if (codeResponse.ok()) {
      response = await request.post("/api/auth/register", {
        data: { phone, password, displayName, verificationCode: E2E_SMS_CODE },
      });
      if (response.status() === 409) response = await request.post("/api/auth/login", { data: { phone, password } });
    } else if (codeResponse.status() === 429) {
      for (let attempt = 0; attempt < 20 && response.status() === 401; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        response = await request.post("/api/auth/login", { data: { phone, password } });
      }
    } else {
      throw new Error(`Verification code request failed (${codeResponse.status()}): ${await codeResponse.text()}`);
    }
  }
  if (!response.ok()) throw new Error(`Authentication failed (${response.status()}): ${await response.text()}`);
  return (await response.json()) as { token: string };
}
