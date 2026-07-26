import { describe, expect, test } from "bun:test";

describe("AI billing navigation and account menu", () => {
  test("publishes paginated recharge and consumption contracts", async () => {
    const spec = await Bun.file("openapi/openapi.json").json();
    const recharges = spec.paths["/api/billing/ai/recharges"]?.get;
    const consumption = spec.paths["/api/billing/ai/consumption"]?.get;
    expect(recharges?.operationId).toBe("listAiRechargeRecords");
    expect(consumption?.operationId).toBe("listAiConsumptionRecords");
    expect(recharges.parameters.map((parameter: { name: string }) => parameter.name)).toEqual(["page", "pageSize"]);
    expect(consumption.parameters.map((parameter: { name: string }) => parameter.name)).toEqual(["page", "pageSize"]);
    expect(recharges.responses["200"].content["application/json"].schema.properties.records.items.$ref).toContain(
      "AiRechargeRecord",
    );
    expect(consumption.responses["200"].content["application/json"].schema.properties.records.items.$ref).toContain(
      "AiConsumptionRecord",
    );
  });

  test("routes one bill page with a switch through the generated SDK and shared table", async () => {
    const router = await Bun.file("web/app/router.tsx").text();
    const page = await Bun.file("web/features/billing/ai-billing-page.tsx").text();
    expect(router).toContain('path: "/billing/ai"');
    expect(router).not.toContain('path: "/billing/ai/recharges"');
    expect(router).not.toContain('path: "/billing/ai/consumption"');
    expect(page).toContain("listAiRechargeRecords");
    expect(page).toContain("listAiConsumptionRecords");
    expect(page).toContain("<DataTable");
    expect(page).toContain("<Switch");
    expect(page).toContain('setType(checked ? "consumption" : "recharges")');
    expect(page).toContain(">AI账单</h1>");
    expect(page).toContain("已退回");
  });

  test("keeps one AI billing entry and the admin entry in the account menu", async () => {
    const shell = await Bun.file("web/components/domain/app-shell.tsx").text();
    expect(shell).not.toContain('"数据账单"');
    expect(shell).toContain('to="/billing/ai"');
    expect(shell).toContain("AI账单");
    expect(shell).not.toContain("sidebar-parent");
    expect(shell).not.toContain("sidebar-submenu");
    expect(shell).toContain('aria-label="用户菜单"');
    expect(shell).toContain("个人资料");
    expect(shell).toContain("账号与密码");
    expect(shell).toContain("退出登录");
    expect(shell).toContain("{user.isAdmin && (");
    expect(shell).toContain('to="/admin"');
    expect(shell).not.toContain('aria-label="系统管理"');
  });
});
