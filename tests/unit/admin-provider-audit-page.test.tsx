import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AdminProviderAudit, AdminProviderAuditDetail } from "../../web/api/api-client";
import {
  AuditDetail,
  buildProviderAuditQuery,
  ProviderAuditTable,
} from "../../web/features/admin/provider-audit-panel";

const audit: AdminProviderAudit = {
  id: "4f58f91d-23dd-4dc4-9669-f685b237f225",
  jobId: "job-audit-table",
  ownerUserId: "7152f865-5d4b-4cf2-b7cb-7592b339e77c",
  userPhone: "13800000131",
  userDisplayName: "审计用户",
  moduleId: "video-create",
  capability: "video-generate",
  provider: "aihubmix",
  model: "seedance-1-5-pro",
  operation: "generate-shot",
  providerTaskId: "provider-task-99",
  providerRequestId: "provider-request-99",
  status: "succeeded",
  assetCount: 1,
  submittedAt: "2026-07-26T03:00:00.000Z",
  completedAt: "2026-07-26T03:00:04.000Z",
  durationMs: 4000,
};

const detail: AdminProviderAuditDetail = {
  ...audit,
  requestPayload: { prompt: "蓝色连衣裙商品视频" },
  responsePayload: { status: "done" },
  assetIds: ["asset-result-1"],
  assets: [
    {
      id: "asset-result-1",
      name: "result.mp4",
      mimeType: "video/mp4",
      thumbnailUrl: "https://files.xbeaconai.com/users/demo/result.mp4",
      url: "https://files.xbeaconai.com/users/demo/result.mp4",
      originalUrl: "https://files.xbeaconai.com/users/demo/result.mp4",
      available: true,
    },
  ],
  createdAt: audit.submittedAt,
  updatedAt: "2026-07-26T03:00:04.000Z",
};

describe("admin provider audit panel", () => {
  test("renders the shared data table with user, provider, timing, status, and generated result columns", () => {
    const html = renderToStaticMarkup(<ProviderAuditTable audits={[audit]} onView={() => undefined} />);

    for (const header of ["提交时间", "用户", "模块", "Provider / 模型", "第三方任务", "状态", "耗时", "结果", "操作"])
      expect(html).toContain(header);
    expect(html).toContain("审计用户");
    expect(html).toContain("13800000131");
    expect(html).toContain("seedance-1-5-pro");
    expect(html).toContain("provider-task-99");
    expect(html).toContain("4.0s");
  });

  test("normalizes compact filters into the paginated administrator query", () => {
    expect(
      buildProviderAuditQuery({
        page: 3,
        search: " 13800000131 ",
        provider: "aihubmix",
        moduleId: "video-create",
        status: "succeeded",
        startedFrom: "2026-07-01",
        startedTo: "2026-07-26",
      }),
    ).toEqual({
      page: 3,
      pageSize: 25,
      query: "13800000131",
      provider: "aihubmix",
      moduleId: "video-create",
      status: "succeeded",
      startedFrom: new Date("2026-07-01T00:00:00.000").toISOString(),
      startedTo: new Date("2026-07-26T23:59:59.999").toISOString(),
    });
  });

  test("shows user, original request, response, time, and CDN material result in the read-only detail", () => {
    const html = renderToStaticMarkup(<AuditDetail detail={detail} loading={false} />);

    expect(html).toContain("13800000131");
    expect(html).toContain("蓝色连衣裙商品视频");
    expect(html).toContain("&quot;status&quot;: &quot;done&quot;");
    expect(html).toContain("result.mp4");
    expect(html).toContain("https://files.xbeaconai.com/users/demo/result.mp4");
    expect(html).toContain("第三方任务 ID");
  });
});
