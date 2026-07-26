import { afterEach, describe, expect, mock, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { AccountReleaseError, AdminAccountReleaseService } from "../../server/admin/account-release-service";
import {
  adminCreditGrants,
  adScriptProjects,
  adScriptVariants,
  adScriptVersions,
  arkPortraitGroups,
  artifacts,
  assetFolders,
  authSessions,
  creditCharges,
  creditRefunds,
  customPortraits,
  jobs,
  mediaAssets,
  moduleOutputFolderDefaults,
  notifications,
  objectCleanup,
  passwordSetupTokens,
  providerCredentials,
  providerGenerationAudits,
  rechargeOrders,
  smsVerificationCodes,
  userPreferences,
  users,
  videoCreateMaterialVersions,
  videoCreateProjects,
  videoCreateScriptSections,
  videoCreateScriptVersions,
  videoCreateShots,
} from "../../server/db/schema";
import { env } from "../../server/env";
import type { JobRecord } from "../../server/types";
import { createTestAccountStore, registerTestAccount } from "./account-test-helper";

const databases: string[] = [];
const directories: string[] = [];
const primaryAdminPhone = () => {
  const phone = env.adminPhones.values().next().value;
  if (!phone) throw new Error("ADMIN_PHONE must contain at least one phone number");
  return phone;
};

afterEach(async () => {
  for (const path of databases.splice(0)) {
    rmSync(path, { force: true });
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
  }
  for (const path of directories.splice(0)) await rm(path, { force: true, recursive: true });
});

function terminalJob(id: string, ownerUserId: string, stagingKeys: string[]): JobRecord {
  const now = new Date().toISOString();
  return {
    id,
    ownerUserId,
    moduleId: "video-create",
    title: "待清理任务",
    status: "failed",
    progress: 100,
    stage: "失败",
    overallExecutionMode: "real",
    values: {},
    executionPlan: [],
    provenance: [],
    cancelRequested: false,
    providerCancelState: "none",
    stagingKeys,
    jobSchemaVersion: 2,
    createdAt: now,
    updatedAt: now,
  };
}

describe("admin account release", () => {
  test("deletes external resources, local files, and every owned database hierarchy", async () => {
    const databasePath = join(tmpdir(), `account-release-${crypto.randomUUID()}.sqlite`);
    const dataDir = join(tmpdir(), `account-release-data-${crypto.randomUUID()}`);
    databases.push(databasePath);
    directories.push(dataDir);
    const accounts = createTestAccountStore(databasePath);
    const admin = await registerTestAccount(accounts, {
      phone: primaryAdminPhone(),
      password: "Password123",
      displayName: "管理员",
    });
    const member = await registerTestAccount(accounts, {
      phone: "13800000401",
      password: "Password123",
      displayName: "待释放用户",
    });
    const survivor = await registerTestAccount(accounts, {
      phone: "13800000402",
      password: "Password123",
      displayName: "保留用户",
    });
    const now = new Date().toISOString();
    const jobId = crypto.randomUUID();
    const assetId = crypto.randomUUID();
    const mediaKey = `${member.user.id}/portraits/source.jpg`;
    const stagingKey = `seedance-staging/active/${jobId}/input.mp4`;
    const artifactKey = `results/${jobId}/output.mp4`;
    const projectId = crypto.randomUUID();
    const variantId = crypto.randomUUID();
    const sectionId = crypto.randomUUID();
    const shotId = crypto.randomUUID();

    accounts.db
      .insert(jobs)
      .values(terminalJob(jobId, member.user.id, [stagingKey]))
      .run();
    accounts.db
      .insert(mediaAssets)
      .values({
        id: assetId,
        ownerUserId: member.user.id,
        originalName: "source.jpg",
        storageKey: mediaKey,
        mimeType: "image/jpeg",
        byteSize: 128,
        assetKind: "portrait",
        displayName: "自建虚拟人像",
        createdAt: now,
      })
      .run();
    accounts.db
      .insert(arkPortraitGroups)
      .values({
        ownerUserId: member.user.id,
        groupId: "ark-group-1",
        projectName: "default",
        status: "active",
        claimToken: jobId,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    accounts.db
      .insert(customPortraits)
      .values({
        assetId,
        jobId,
        ownerUserId: member.user.id,
        groupId: "ark-group-1",
        arkAssetId: "ark-asset-1",
        gender: "女",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    accounts.db
      .insert(providerGenerationAudits)
      .values({
        id: crypto.randomUUID(),
        jobId,
        ownerUserId: member.user.id,
        moduleId: "video-create",
        capability: "video",
        provider: "ark",
        operation: "generate",
        status: "failed",
        requestPayload: {},
        assetIds: [assetId],
        submittedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    accounts.db
      .insert(artifacts)
      .values({
        id: crypto.randomUUID(),
        ownerUserId: member.user.id,
        jobId,
        storageKey: artifactKey,
        name: "output.mp4",
        mimeType: "video/mp4",
        createdAt: now,
      })
      .run();
    accounts.db
      .insert(objectCleanup)
      .values({ objectKey: stagingKey, jobId, nextAttemptAt: now, createdAt: now })
      .run();
    accounts.db
      .insert(adScriptProjects)
      .values({
        id: projectId,
        ownerUserId: member.user.id,
        jobId,
        status: "failed",
        input: {} as (typeof adScriptProjects.$inferInsert)["input"],
        createdAt: now,
        updatedAt: now,
      })
      .run();
    accounts.db
      .insert(adScriptVariants)
      .values({ id: variantId, projectId, ordinal: 1, status: "failed", createdAt: now, updatedAt: now })
      .run();
    accounts.db
      .insert(adScriptVersions)
      .values({
        id: crypto.randomUUID(),
        variantId,
        sequence: 1,
        source: "initial",
        round: 1,
        script: "脚本",
        score: {} as (typeof adScriptVersions.$inferInsert)["score"],
        compliance: {} as (typeof adScriptVersions.$inferInsert)["compliance"],
        changeSummary: "初稿",
        model: "test",
        createdAt: now,
      })
      .run();
    accounts.db
      .insert(videoCreateProjects)
      .values({
        id: projectId,
        ownerUserId: member.user.id,
        title: "一键成片",
        status: "failed",
        input: {} as (typeof videoCreateProjects.$inferInsert)["input"],
        currentJobId: jobId,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    accounts.db
      .insert(videoCreateScriptSections)
      .values({ id: sectionId, projectId, ordinal: 1, label: "开场", createdAt: now, updatedAt: now })
      .run();
    accounts.db
      .insert(videoCreateScriptVersions)
      .values({
        id: crypto.randomUUID(),
        sectionId,
        sequence: 1,
        source: "generated",
        text: "旁白",
        durationSec: 3,
        model: "test",
        createdAt: now,
      })
      .run();
    accounts.db
      .insert(videoCreateShots)
      .values({
        id: shotId,
        projectId,
        scriptSectionId: sectionId,
        ordinal: 1,
        prompt: "镜头",
        durationSec: 3,
        status: "failed",
        jobId,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    accounts.db
      .insert(videoCreateMaterialVersions)
      .values({
        id: crypto.randomUUID(),
        projectId,
        shotId,
        source: "ai_generated",
        status: "failed",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    accounts.db
      .insert(notifications)
      .values({
        id: crypto.randomUUID(),
        userId: member.user.id,
        type: "test",
        title: "通知",
        body: "正文",
        createdAt: now,
      })
      .run();
    accounts.db
      .insert(rechargeOrders)
      .values({
        id: crypto.randomUUID(),
        userId: member.user.id,
        idempotencyKey: "release-recharge",
        packageId: "starter",
        amountCny: 1,
        credits: 1,
        balanceAfter: 1,
        requestFingerprint: "release",
        status: "succeeded",
        createdAt: now,
        completedAt: now,
      })
      .run();
    accounts.db
      .insert(adminCreditGrants)
      .values({
        id: crypto.randomUUID(),
        userId: member.user.id,
        adminUserId: admin.user.id,
        idempotencyKey: "release-grant",
        requestFingerprint: "release",
        credits: 1,
        balanceAfter: 1,
        createdAt: now,
      })
      .run();
    accounts.db
      .insert(creditCharges)
      .values({ id: crypto.randomUUID(), userId: member.user.id, jobId, amount: 1, balanceAfter: 1, createdAt: now })
      .run();
    accounts.db
      .insert(creditRefunds)
      .values({
        id: crypto.randomUUID(),
        userId: member.user.id,
        jobId,
        amount: 1,
        balanceAfter: 2,
        reason: "test",
        createdAt: now,
      })
      .run();
    accounts.db
      .insert(providerCredentials)
      .values({
        name: "RELEASE_TEST_KEY",
        ciphertext: "ciphertext",
        nonce: "nonce",
        authTag: "tag",
        lastFour: "test",
        updatedByUserId: member.user.id,
        updatedAt: now,
      })
      .run();

    accounts.createSession(member.user.id, new Date(Date.now() + 60_000).toISOString());
    accounts.setAdminUserStatus({ userId: member.user.id, adminUserId: admin.user.id, status: "disabled" });
    await mkdir(join(dataDir, "uploads", member.user.id), { recursive: true });
    await Bun.write(join(dataDir, "uploads", member.user.id, "source.jpg"), "portrait");

    const operations: string[] = [];
    const storage = {
      configured: true,
      deletePrefixPermanently: mock(async (prefix: string) => {
        operations.push(`tos-prefix:${prefix}`);
        return 4;
      }),
      deleteKeysPermanently: mock(async (keys: string[]) => {
        operations.push(`tos-keys:${keys.sort().join(",")}`);
        return keys.length;
      }),
    };
    const ark = {
      configured: true,
      deleteAsset: mock(async (id: string) => operations.push(`ark-asset:${id}`)),
      deleteAssetGroup: mock(async (id: string) => operations.push(`ark-group:${id}`)),
    };

    const result = await new AdminAccountReleaseService(accounts, { storage, ark, dataDir }).releaseUser(
      member.user.id,
      admin.user.id,
    );

    expect(result).toMatchObject({ userId: member.user.id, deletedArkAssets: 1, deletedArkGroups: 1 });
    expect(operations).toEqual([
      "ark-asset:ark-asset-1",
      "ark-group:ark-group-1",
      `tos-prefix:${member.user.id}/`,
      `tos-keys:${[artifactKey, stagingKey].sort().join(",")}`,
    ]);
    expect(existsSync(join(dataDir, "uploads", member.user.id))).toBe(false);
    expect(accounts.getUser(member.user.id)).toBeUndefined();
    expect(accounts.getUser(survivor.user.id)?.displayName).toBe("保留用户");
    expect(accounts.db.select().from(jobs).where(eq(jobs.ownerUserId, member.user.id)).all()).toHaveLength(0);
    expect(
      accounts.db.select().from(mediaAssets).where(eq(mediaAssets.ownerUserId, member.user.id)).all(),
    ).toHaveLength(0);
    expect(
      accounts.db.select().from(adScriptProjects).where(eq(adScriptProjects.ownerUserId, member.user.id)).all(),
    ).toHaveLength(0);
    expect(
      accounts.db.select().from(videoCreateProjects).where(eq(videoCreateProjects.ownerUserId, member.user.id)).all(),
    ).toHaveLength(0);
    expect(
      accounts.db.select().from(assetFolders).where(eq(assetFolders.ownerUserId, member.user.id)).all(),
    ).toHaveLength(0);
    expect(
      accounts.db.select().from(userPreferences).where(eq(userPreferences.userId, member.user.id)).all(),
    ).toHaveLength(0);
    expect(
      accounts.db
        .select()
        .from(moduleOutputFolderDefaults)
        .where(eq(moduleOutputFolderDefaults.ownerUserId, member.user.id))
        .all(),
    ).toHaveLength(0);
    expect(accounts.db.select().from(authSessions).where(eq(authSessions.userId, member.user.id)).all()).toHaveLength(
      0,
    );
    expect(
      accounts.db.select().from(passwordSetupTokens).where(eq(passwordSetupTokens.userId, member.user.id)).all(),
    ).toHaveLength(0);
    expect(
      accounts.db.select().from(smsVerificationCodes).where(eq(smsVerificationCodes.phone, member.user.phone)).all(),
    ).toHaveLength(0);
    expect(accounts.db.select().from(users).where(eq(users.id, member.user.id)).all()).toHaveLength(0);
    expect(
      accounts.db.select().from(providerCredentials).where(eq(providerCredentials.name, "RELEASE_TEST_KEY")).get()
        ?.updatedByUserId,
    ).toBeNull();
    accounts.close();
  });

  test("keeps the account and database records when TOS deletion fails", async () => {
    const databasePath = join(tmpdir(), `account-release-failure-${crypto.randomUUID()}.sqlite`);
    databases.push(databasePath);
    const accounts = createTestAccountStore(databasePath);
    const admin = await registerTestAccount(accounts, {
      phone: primaryAdminPhone(),
      password: "Password123",
      displayName: "管理员",
    });
    const member = await registerTestAccount(accounts, {
      phone: "13800000403",
      password: "Password123",
      displayName: "删除失败用户",
    });
    accounts.setAdminUserStatus({ userId: member.user.id, adminUserId: admin.user.id, status: "disabled" });
    const service = new AdminAccountReleaseService(accounts, {
      storage: {
        configured: true,
        deletePrefixPermanently: async () => {
          throw new Error("TOS unavailable");
        },
        deleteKeysPermanently: async () => 0,
      },
      ark: { configured: true, deleteAsset: async () => undefined, deleteAssetGroup: async () => undefined },
    });

    await expect(service.releaseUser(member.user.id, admin.user.id)).rejects.toThrow("TOS unavailable");
    expect(accounts.getUserSecurity(member.user.id)?.status).toBe("disabled");
    expect(
      accounts.db.select().from(assetFolders).where(eq(assetFolders.ownerUserId, member.user.id)).all().length,
    ).toBeGreaterThan(0);
    accounts.close();
  });

  test("rejects active accounts, administrators, and disabled accounts with unfinished jobs", async () => {
    const databasePath = join(tmpdir(), `account-release-guards-${crypto.randomUUID()}.sqlite`);
    databases.push(databasePath);
    const accounts = createTestAccountStore(databasePath);
    const admin = await registerTestAccount(accounts, {
      phone: primaryAdminPhone(),
      password: "Password123",
      displayName: "管理员",
    });
    const member = await registerTestAccount(accounts, {
      phone: "13800000404",
      password: "Password123",
      displayName: "运行中用户",
    });
    const service = new AdminAccountReleaseService(accounts, {
      storage: { configured: true, deletePrefixPermanently: async () => 0, deleteKeysPermanently: async () => 0 },
      ark: { configured: true, deleteAsset: async () => undefined, deleteAssetGroup: async () => undefined },
    });

    await expect(service.releaseUser(member.user.id, admin.user.id)).rejects.toEqual(
      new AccountReleaseError("USER_NOT_DISABLED", "只能释放已注销账号"),
    );
    await expect(service.releaseUser(admin.user.id, admin.user.id)).rejects.toEqual(
      new AccountReleaseError("ADMIN_RELEASE_FORBIDDEN", "不能释放管理员账号"),
    );
    accounts.setAdminUserStatus({ userId: member.user.id, adminUserId: admin.user.id, status: "disabled" });
    const queued = terminalJob(crypto.randomUUID(), member.user.id, []);
    queued.status = "queued";
    accounts.db.insert(jobs).values(queued).run();
    await expect(service.releaseUser(member.user.id, admin.user.id)).rejects.toEqual(
      new AccountReleaseError("USER_HAS_ACTIVE_JOBS", "账号仍有排队或运行中的任务，请等待任务结束后重试", true),
    );
    accounts.close();
  });
});
