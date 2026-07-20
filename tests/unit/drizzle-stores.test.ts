import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountStore } from "../../server/accounts/account-store";
import { SqliteJobStore } from "../../server/jobs/sqlite-job-store";
import type { JobRecord } from "../../server/types";

const databases: string[] = [];
afterEach(() => {
  for (const path of databases.splice(0)) {
    rmSync(path, { force: true });
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
  }
});

describe("Drizzle SQLite stores", () => {
  test("shares typed account, credit, job and cleanup state without raw queries", async () => {
    const path = join(tmpdir(), `drizzle-stores-${crypto.randomUUID()}.sqlite`);
    databases.push(path);
    const accounts = new AccountStore(path);
    const jobs = new SqliteJobStore(path);
    const registration = await accounts.register({
      email: "drizzle@example.com",
      password: "Password123",
      displayName: "Drizzle 用户",
    });

    const session = accounts.createSession(registration.user.id, new Date(Date.now() + 60_000).toISOString());
    expect(
      accounts.validateSession(registration.user.id, session.id, session.jti, session.passwordVersion)?.user.email,
    ).toBe("drizzle@example.com");
    accounts.savePreferences(registration.user.id, {
      theme: "light",
      defaultRatio: "16:9",
      language: "zh-CN",
      taskNotifications: false,
      autoplayResults: true,
    });
    expect(accounts.getPreferences(registration.user.id)).toMatchObject({ theme: "light", autoplayResults: true });
    expect(accounts.recharge(registration.user.id, "starter", "recharge-1").balanceAfter).toBe(3480);

    const timestamp = new Date().toISOString();
    const job: JobRecord = {
      id: crypto.randomUUID(),
      ownerUserId: registration.user.id,
      moduleId: "video-cut",
      title: "Drizzle 任务",
      status: "queued",
      progress: 0,
      stage: "排队中",
      overallExecutionMode: "local",
      values: { method: "按固定时长" },
      executionPlan: [],
      provenance: [],
      cancelRequested: false,
      providerCancelState: "none",
      stagingKeys: [],
      jobSchemaVersion: 2,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    jobs.createCharged(job, 4);
    expect(jobs.getOwned(job.id, registration.user.id)?.values.method).toBe("按固定时长");
    expect(jobs.update(job.id, { status: "succeeded", progress: 100 })?.status).toBe("succeeded");
    expect(accounts.getUser(registration.user.id)?.credits).toBe(3476);

    jobs.scheduleObjectCleanup(job.id, "test/object.mp4", new Error("retry"));
    expect(jobs.pendingObjectCleanup()).toEqual([{ object_key: "test/object.mp4", job_id: job.id, attempts: 1 }]);
    jobs.completeObjectCleanup("test/object.mp4");
    expect(jobs.pendingObjectCleanup()).toEqual([]);

    jobs.close();
    accounts.close();
  });
});
