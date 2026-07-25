import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteJobStore } from "../../server/jobs/sqlite-job-store";
import { CustomPortraitStore } from "../../server/portraits/custom-portrait-store";
import { resolvePortraitReference } from "../../server/portraits/portrait-resolver";
import type { JobRecord } from "../../server/types";
import { createTestAccountStore, registerTestAccount } from "./account-test-helper";

const paths: string[] = [];
afterEach(() => {
  for (const path of paths.splice(0)) {
    rmSync(path, { force: true });
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
  }
});

describe("custom portrait persistence", () => {
  test("isolates owner records and resolves only an active Ark virtual asset", async () => {
    const path = join(tmpdir(), `custom-portrait-${crypto.randomUUID()}.sqlite`);
    paths.push(path);
    const accounts = createTestAccountStore(path);
    const jobs = new SqliteJobStore(path);
    const portraits = new CustomPortraitStore(path);
    const first = await registerTestAccount(accounts, {
      phone: "13800000121",
      password: "Password123",
      displayName: "甲",
    });
    const second = await registerTestAccount(accounts, {
      phone: "13800000122",
      password: "Password123",
      displayName: "乙",
    });
    const timestamp = new Date().toISOString();
    const assetId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    accounts.createAsset({
      id: assetId,
      ownerUserId: first.userId,
      storageKey: `${assetId}.jpg`,
      originalName: "portrait.jpg",
      mimeType: "image/jpeg",
      byteSize: 1024,
      kind: "portrait",
      displayName: "中国 22岁 男 牙医",
      createdAt: timestamp,
    });
    const job: JobRecord = {
      id: jobId,
      ownerUserId: first.userId,
      moduleId: "portrait-asset-register",
      title: "创建虚拟人像",
      status: "queued",
      progress: 0,
      stage: "排队中",
      overallExecutionMode: "real",
      values: { assetId },
      executionPlan: [],
      provenance: [],
      cancelRequested: false,
      providerCancelState: "none",
      stagingKeys: [],
      jobSchemaVersion: 2,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    jobs.create(job);
    portraits.create({ assetId, jobId, ownerUserId: first.userId, createdAt: timestamp });

    expect(portraits.getOwned(second.userId, assetId)).toBeUndefined();
    expect(
      resolvePortraitReference({
        ownerUserId: first.userId,
        reference: { type: "custom", assetId },
        accounts,
        customPortraits: portraits,
      }),
    ).toBeUndefined();

    const claim = portraits.claimGroupCreation(first.userId, jobId);
    expect(claim.claimed).toBe(true);
    portraits.activateGroup(first.userId, jobId, "group-1");
    portraits.update(assetId, {
      groupId: "group-1",
      arkAssetId: "asset-custom-1",
      status: "active",
    });

    expect(
      resolvePortraitReference({
        ownerUserId: first.userId,
        reference: { type: "custom", assetId },
        accounts,
        customPortraits: portraits,
      }),
    ).toMatchObject({
      name: "中国 22岁 男 牙医",
      arkAssetUri: "asset://asset-custom-1",
      imageUrl: `/api/assets/${assetId}/content`,
    });

    portraits.close();
    jobs.close();
    accounts.close();
  });
});
