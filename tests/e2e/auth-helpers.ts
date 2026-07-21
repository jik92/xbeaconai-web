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
  await page.getByLabel("手机号").fill(phone);
  await page.getByRole("button", { name: "获取验证码" }).click();
  await expect(page.getByText("验证码已发送，请查看服务端日志")).toBeVisible();
  await page.getByLabel("短信验证码").fill(E2E_SMS_CODE);
  await page.getByRole("button", { name: "验证并注册" }).click();
  await expect(page.getByText("手机号验证成功，账号已注册，请设置登录密码")).toBeVisible();
  await page.getByLabel("新密码").fill(password);
  await page.getByLabel("确认密码").fill(password);
  await page.getByRole("button", { name: "设置密码并登录" }).click();
  await expect(page.locator(".auth-page")).toBeHidden();
  void displayName;
  return phone;
}

export async function authenticate(request: APIRequestContext, phone: string, password: string, displayName: string) {
  let response = await request.post("/api/auth/login", { data: { phone, password } });
  if (response.status() === 401) {
    const codeResponse = await request.post("/api/auth/sms-code", { data: { phone, purpose: "register" } });
    if (codeResponse.ok()) {
      const registration = await request.post("/api/auth/register", {
        data: { phone, verificationCode: E2E_SMS_CODE },
      });
      if (!registration.ok())
        throw new Error(`Registration failed (${registration.status()}): ${await registration.text()}`);
      const challenge = (await registration.json()) as { setupToken: string };
      response = await request.post("/api/auth/password/setup", {
        data: { setupToken: challenge.setupToken, password },
      });
    } else if (codeResponse.status() === 409) {
      const resetCode = await request.post("/api/auth/sms-code", { data: { phone, purpose: "reset_password" } });
      if (resetCode.ok()) {
        const verification = await request.post("/api/auth/password/verify", {
          data: { phone, verificationCode: E2E_SMS_CODE },
        });
        if (!verification.ok())
          throw new Error(`Password verification failed (${verification.status()}): ${await verification.text()}`);
        const challenge = (await verification.json()) as { setupToken: string };
        response = await request.post("/api/auth/password/setup", {
          data: { setupToken: challenge.setupToken, password },
        });
      } else if (resetCode.status() === 429) {
        for (let attempt = 0; attempt < 20 && response.status() === 401; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          response = await request.post("/api/auth/login", { data: { phone, password } });
        }
      } else {
        throw new Error(`Reset code request failed (${resetCode.status()}): ${await resetCode.text()}`);
      }
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
  void displayName;
  return (await response.json()) as { token: string };
}
