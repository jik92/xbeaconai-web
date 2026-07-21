import { type APIRequestContext, expect, test } from "@playwright/test";

const adminEmail = "zuo.zhong@163.com";
const password = "AdminConsole2026";

async function authenticate(request: APIRequestContext, email: string, displayName: string) {
  let response = await request.post("/api/auth/register", { data: { email, password, displayName } });
  if (response.status() === 409) response = await request.post("/api/auth/login", { data: { email, password } });
  if (!response.ok()) throw new Error(`Authentication failed (${response.status()}): ${await response.text()}`);
  return (await response.json()) as { token: string };
}

test("restricts the admin console and renders credentials and global jobs at desktop and tablet sizes", async ({
  page,
  request,
}, testInfo) => {
  const admin = await authenticate(request, adminEmail, "系统管理员");
  const normal = await authenticate(
    request,
    `normal-${testInfo.project.name}-${crypto.randomUUID()}@example.test`,
    "普通用户",
  );

  const forbidden = await request.get("/api/admin/jobs", { headers: { Authorization: `Bearer ${normal.token}` } });
  expect(forbidden.status()).toBe(403);
  const forbiddenImport = await request.post("/api/admin/credentials/import", {
    headers: { Authorization: `Bearer ${normal.token}` },
    multipart: { file: { name: ".env.key", mimeType: "text/plain", buffer: Buffer.from("OPENAI_KEY=forbidden") } },
  });
  expect(forbiddenImport.status()).toBe(403);

  const credentials = await request.get("/api/admin/credentials", {
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  expect(credentials.status()).toBe(200);
  const body = (await credentials.json()) as { credentials: Array<Record<string, unknown>> };
  expect(body.credentials).toHaveLength(6);
  expect(JSON.stringify(body)).not.toContain("ciphertext");

  await page.addInitScript((token) => localStorage.setItem("yaozuo:auth-token:v1", token), admin.token);
  await page.goto("/admin");
  await expect(page.locator(".admin-container")).toBeVisible();
  await expect(page.locator(".admin-page h1")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "密钥管理" })).toBeVisible();
  await expect(page.getByText("AES-256-GCM 加密存储")).toBeVisible();
  await page.getByLabel("选择 .env.key 文件").setInputFiles({
    name: ".env.key",
    mimeType: "text/plain",
    buffer: Buffer.from("OPENAI_KEY=e2e-import-secret\nJWT_SECRET=ignored-system-secret\n"),
  });
  await expect(page.getByText("已更新 1 项，跳过 5 项，忽略 1 个非白名单字段")).toBeVisible();
  await expect(page.locator(".admin-container")).not.toContainText("e2e-import-secret");
  await expect(page.locator(".admin-container")).not.toContainText("ignored-system-secret");
  await page.getByRole("button", { name: "队列任务" }).click();
  await expect(page.getByPlaceholder("搜索用户邮箱")).toBeVisible();
  await expect(page.getByText(/共 \d+ 个任务/)).toBeVisible();
  await expect(page.locator(".admin-job-table")).toBeInViewport();
});
