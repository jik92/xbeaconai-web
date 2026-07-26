import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { userPreferences, users } from "../../server/db/schema";
import { VideoCreateInputSchema } from "../../server/video-create/types";

const testDataDir = mkdtempSync(join(tmpdir(), "yaozuo-video-create-records-api-test-"));
process.env.YAOZUO_DATA_DIR = testDataDir;

const appModule = await import("../../server/app");
const honoApp = appModule.app;
const realAccounts = appModule.accounts;
const realStore = appModule.store;
const realVideoCreates = appModule.videoCreates;
const { issueToken } = await import("../../server/accounts/auth");

let token = "";
let ownerUserId = "";
let otherUserId = "";
let firstProjectId = "";
let firstProjectVersion = 0;
let otherProjectId = "";

async function createUser(displayName: string) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const phone = `137${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  realStore.db
    .insert(users)
    .values({
      id,
      phone,
      passwordHash: await Bun.password.hash("ApiTest12345!@#$"),
      displayName,
      avatarText: displayName.slice(0, 2),
      credits: 100,
      status: "active",
      passwordVersion: 1,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  realStore.db.insert(userPreferences).values({ userId: id, updatedAt: now }).run();
  return { id, phone, displayName, avatarText: displayName.slice(0, 2), credits: 100, isAdmin: false };
}

function projectInput(productName: string) {
  return VideoCreateInputSchema.parse({
    productAssetIds: [],
    scene: "内容种草",
    productName,
    durationSec: 15,
    segmentCount: 2,
    speechRate: "medium",
  });
}

beforeAll(async () => {
  const owner = await createUser("生成记录用户");
  ownerUserId = owner.id;
  token = (await issueToken(realAccounts, owner)).token;
  otherUserId = (await createUser("其他生成用户")).id;

  firstProjectId = crypto.randomUUID();
  const first = realVideoCreates.createDraft({
    id: firstProjectId,
    ownerUserId,
    title: "夏季草帽生成",
    projectInput: projectInput("夏季草帽"),
  });
  firstProjectVersion = first.project.version;
  realVideoCreates.createDraft({
    id: crypto.randomUUID(),
    ownerUserId,
    title: "通勤衬衫生成",
    projectInput: projectInput("通勤衬衫"),
  });
  otherProjectId = crypto.randomUUID();
  realVideoCreates.createDraft({
    id: otherProjectId,
    ownerUserId: otherUserId,
    title: "不可见项目",
    projectInput: projectInput("不可见商品"),
  });
});

afterAll(() => {
  realVideoCreates.close();
  realAccounts.close();
  realStore.close();
  rmSync(testDataDir, { recursive: true, force: true });
});

const headers = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

describe("video create project records API", () => {
  test("searches, filters, paginates, and isolates owners", async () => {
    const page = await honoApp.request(
      "/api/video-create/projects?query=%E7%94%9F%E6%88%90&status=draft&page=1&pageSize=1",
      {
        headers: headers(),
      },
    );
    expect(page.status).toBe(200);
    const body = (await page.json()) as {
      projects: Array<{ project: { id: string } }>;
      total: number;
      pageSize: number;
    };
    expect(body.total).toBe(2);
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0]?.project.id).not.toBe(otherProjectId);
    expect(body.pageSize).toBe(1);

    const hidden = await honoApp.request("/api/video-create/projects?query=%E4%B8%8D%E5%8F%AF%E8%A7%81", {
      headers: headers(),
    });
    expect(hidden.status).toBe(200);
    expect(((await hidden.json()) as { total: number }).total).toBe(0);
  });

  test("renames with version checks and rejects cross-owner updates", async () => {
    const renamed = await honoApp.request(`/api/video-create/projects/${firstProjectId}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ expectedVersion: firstProjectVersion, title: "夏季草帽紧凑记录" }),
    });
    expect(renamed.status).toBe(200);
    const renamedBody = (await renamed.json()) as { project: { title: string; version: number } };
    expect(renamedBody.project.title).toBe("夏季草帽紧凑记录");
    expect(renamedBody.project.version).toBe(firstProjectVersion + 1);

    const conflict = await honoApp.request(`/api/video-create/projects/${firstProjectId}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ expectedVersion: firstProjectVersion, title: "冲突标题" }),
    });
    expect(conflict.status).toBe(409);

    const crossOwner = await honoApp.request(`/api/video-create/projects/${otherProjectId}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ expectedVersion: 1, title: "越权标题" }),
    });
    expect(crossOwner.status).toBe(404);
  });
});
