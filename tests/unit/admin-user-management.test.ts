import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountError } from "../../server/accounts/account-store";
import { env } from "../../server/env";
import { createTestAccountStore, registerTestAccount } from "./account-test-helper";

const databases: string[] = [];

afterEach(() => {
  for (const path of databases.splice(0)) {
    rmSync(path, { force: true });
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
  }
});

describe("admin user management", () => {
  test("lists users, grants credits idempotently, disables sessions and restores the account", async () => {
    const path = join(tmpdir(), `admin-users-${crypto.randomUUID()}.sqlite`);
    databases.push(path);
    const store = createTestAccountStore(path);
    const admin = await registerTestAccount(store, {
      phone: env.adminPhone,
      password: "Password123",
      displayName: "管理员",
    });
    const member = await registerTestAccount(store, {
      phone: "13800000031",
      password: "Password123",
      displayName: "测试成员",
    });
    const session = store.createSession(member.user.id, new Date(Date.now() + 60_000).toISOString());

    expect(store.listAdminUsers({ page: 1, pageSize: 10, query: "测试成员", status: "active" })).toMatchObject({
      total: 1,
      users: [{ id: member.user.id, phone: "13800000031", status: "active" }],
    });

    const grant = store.grantAdminCredits({
      userId: member.user.id,
      adminUserId: admin.user.id,
      credits: 500,
      idempotencyKey: "grant-1",
    });
    expect(grant).toMatchObject({ credits: 500, balanceAfter: 2980 });
    expect(
      store.grantAdminCredits({
        userId: member.user.id,
        adminUserId: admin.user.id,
        credits: 500,
        idempotencyKey: "grant-1",
      }),
    ).toEqual(grant);
    expect(store.getUser(member.user.id)?.credits).toBe(2980);

    const disabled = store.setAdminUserStatus({
      userId: member.user.id,
      adminUserId: admin.user.id,
      status: "disabled",
    });
    expect(disabled.status).toBe("disabled");
    expect(store.validateSession(member.user.id, session.id, session.jti, session.passwordVersion)).toBeUndefined();
    expect(() =>
      store.grantAdminCredits({
        userId: member.user.id,
        adminUserId: admin.user.id,
        credits: 100,
        idempotencyKey: "grant-disabled",
      }),
    ).toThrow("只能为正常用户充值");

    expect(
      store.setAdminUserStatus({ userId: member.user.id, adminUserId: admin.user.id, status: "active" }).status,
    ).toBe("active");
    expect(() =>
      store.setAdminUserStatus({ userId: admin.user.id, adminUserId: admin.user.id, status: "disabled" }),
    ).toThrow(new AccountError("ADMIN_SELF_DISABLE_FORBIDDEN", "不能注销管理员账号", 409));

    store.close();
  });
});
