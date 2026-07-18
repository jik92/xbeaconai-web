import { describe, expect, test } from "bun:test";
import { accounts, app, queue, store } from "../../server/app";
import {
  APP_CONFIG,
  isAssetOpen,
  isModuleOpen,
  type PublicAppConfig,
  resolveHomeDestination,
} from "../../src/app/config";
import { modules } from "../../src/app/routes";

const allClosedConfig: PublicAppConfig = {
  projectName: "测试品牌",
  menuFeatures: {
    creationWorkflow: { "video-remix": false, "video-create": false, "ad-script": false },
    aiToolbox: {
      "ai-generate": false,
      "video-cut": false,
      "media-understand": false,
      "video-mashup": false,
      "voice-clone": false,
      "video-renewal": false,
      "subtitle-erase": false,
      "video-enhancement": false,
      kickart: false,
    },
    assets: { portraits: false },
  },
};

describe("unified project config", () => {
  test("covers all menu entries and keeps the approved defaults", () => {
    const configuredModuleIds = [
      ...Object.keys(APP_CONFIG.menuFeatures.creationWorkflow),
      ...Object.keys(APP_CONFIG.menuFeatures.aiToolbox),
    ].sort();
    expect(configuredModuleIds).toEqual(modules.map((item) => item.id).sort());
    expect(Object.keys(APP_CONFIG.menuFeatures.assets)).toEqual(["portraits"]);
    expect(APP_CONFIG.projectName).toBe("曜作");
    expect(resolveHomeDestination(modules)).toEqual({ kind: "route", path: "/tools/ai-generate" });
    expect(isAssetOpen("portraits")).toBeTrue();
  });

  test("serves the configured project name through backend product copy", async () => {
    const response = await app.request("http://local/openapi.json");
    const document = (await response.json()) as { info: { title: string } };
    expect(document.info.title).toBe(`${APP_CONFIG.projectName} AI 创作 API`);
  });

  test("boolean fixtures control every group and produce a loop-free fallback", () => {
    for (const module of modules) expect(isModuleOpen(module.id, allClosedConfig)).toBeFalse();
    expect(isAssetOpen("portraits", allClosedConfig)).toBeFalse();
    expect(resolveHomeDestination(modules, allClosedConfig)).toEqual({ kind: "project-coming-soon" });

    const portraitOnly: PublicAppConfig = {
      ...allClosedConfig,
      menuFeatures: { ...allClosedConfig.menuFeatures, assets: { portraits: true } },
    };
    expect(resolveHomeDestination(modules, portraitOnly)).toEqual({ kind: "route", path: "/assets/portraits" });

    const remixOnly: PublicAppConfig = {
      ...allClosedConfig,
      menuFeatures: {
        ...allClosedConfig.menuFeatures,
        creationWorkflow: { ...allClosedConfig.menuFeatures.creationWorkflow, "video-remix": true },
      },
    };
    expect(resolveHomeDestination(modules, remixOnly)).toEqual({ kind: "route", path: "/aigc/video-remix" });

    const toolboxOnly: PublicAppConfig = {
      ...allClosedConfig,
      menuFeatures: {
        ...allClosedConfig.menuFeatures,
        aiToolbox: { ...allClosedConfig.menuFeatures.aiToolbox, "video-cut": true },
      },
    };
    expect(resolveHomeDestination(modules, toolboxOnly)).toEqual({ kind: "route", path: "/tools/video-cut" });
  });

  test("Hono rejects disabled modules before any persistent side effect", async () => {
    const email = `project-config-${crypto.randomUUID()}@example.com`,
      password = "Workflow12345";
    const registration = await app.request("http://local/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, displayName: "工作流验收" }),
    });
    expect(registration.status).toBe(201);
    const auth = (await registration.json()) as { token: string; user: { id: string; credits: number } };
    const notificationsBefore = accounts.listNotifications(auth.user.id).notifications.length;
    expect(accounts.listNotifications(auth.user.id).notifications[0]?.title).toBe(`欢迎来到${APP_CONFIG.projectName}`);
    const jobsBefore = store.db.query("SELECT COUNT(*) AS count FROM jobs WHERE owner_user_id=?").get(auth.user.id) as {
      count: number;
    };

    for (const moduleId of Object.keys(APP_CONFIG.menuFeatures.creationWorkflow)) {
      const idempotencyKey = crypto.randomUUID();
      const response = await app.request(`http://local/api/${moduleId}/jobs`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${auth.token}`,
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({ title: "blocked", values: {}, allowMockFallback: true }),
      });
      expect(response.status).toBe(403);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe("FEATURE_NOT_OPEN");
      expect(
        store.db
          .query("SELECT COUNT(*) AS count FROM jobs WHERE owner_user_id=? AND idempotency_key=?")
          .get(auth.user.id, idempotencyKey),
      ).toEqual({ count: 0 });
    }

    const jobsAfter = store.db.query("SELECT COUNT(*) AS count FROM jobs WHERE owner_user_id=?").get(auth.user.id) as {
      count: number;
    };
    const meResponse = await app.request("http://local/api/auth/me", {
      headers: { authorization: `Bearer ${auth.token}` },
    });
    const me = (await meResponse.json()) as { user: { credits: number } };
    expect(jobsAfter.count).toBe(jobsBefore.count);
    expect(me.user.credits).toBe(auth.user.credits);
    expect(accounts.listNotifications(auth.user.id).notifications).toHaveLength(notificationsBefore);
    expect(queue.state()).toEqual({ pending: 0, queued: 0, active: 0 });
  });
});
