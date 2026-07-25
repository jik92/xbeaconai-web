# Provider Generation Audit Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an administrator-only audit log that traces every real third-party material generation/processing task from its original request through its final generated assets.

**Architecture:** Persist one aggregate audit row per local job/capability/operation in SQLite. Worker jobs call a small lifecycle API (`begin`, `progress`, `complete`) around real Provider work; the administrator API returns a compact paginated list and a detailed record with signed material previews. The admin UI adds a shared `DataTable` tab and a compact detail dialog.

**Tech Stack:** Bun, TypeScript strict, SQLite, Drizzle ORM, Hono OpenAPI/Zod, React 19, TanStack Query/Table, shared shadcn-style UI.

## Global Constraints

- Work directly on `main`; do not create a branch.
- Use Drizzle ORM for all business CRUD and generate a new forward migration.
- Never manually edit `web/api/generated/`, `openapi/openapi.json`, or `drizzle/meta/`.
- Store only redacted request/response data; credentials and authorization values must never enter audit JSON.
- Audit write failures must not fail the user's Provider task.
- Only real third-party generation/processing calls are audited; local Mock paths are excluded.
- Reuse `web/components/ui/data-table.tsx` and the existing compact admin-page visual language.
- Do not run E2E unless the user explicitly requests it.

---

### Task 1: Audit Schema, Redaction, and Store

**Files:**
- Modify: `server/db/schema.ts`
- Create: `server/audit/provider-generation-audit-store.ts`
- Create: `tests/unit/provider-generation-audit-store.test.ts`
- Generate: `drizzle/0013_*.sql`
- Generate: `drizzle/meta/0013_snapshot.json`
- Modify generated journal: `drizzle/meta/_journal.json`

**Interfaces:**
- Produces: `ProviderAuditStatus`, `ProviderGenerationAuditSummary`, `ProviderGenerationAuditDetail`
- Produces: `redactAuditPayload(value: unknown): unknown`
- Produces: `ProviderGenerationAuditStore.begin(input)`, `.progress(input)`, `.complete(input)`, `.list(input)`, `.get(id)`
- Consumes: shared `AppDatabase` and default `env.databasePath`

- [ ] **Step 1: Write failing Store tests**

```ts
test("redacts secrets recursively and inside URL query strings", () => {
  expect(redactAuditPayload({
    apiKey: "secret",
    nested: { authorization: "Bearer abc", prompt: "keep" },
    url: "https://provider.test/generate?token=abc&model=x",
  })).toEqual({
    apiKey: "[REDACTED]",
    nested: { authorization: "[REDACTED]", prompt: "keep" },
    url: "https://provider.test/generate?token=%5BREDACTED%5D&model=x",
  });
});

test("aggregates begin progress and completion into one audit row", () => {
  const begun = store.begin({
    jobId: "job-1",
    ownerUserId: member.user.id,
    moduleId: "ai-generate",
    capability: "video-generate",
    provider: "aihubmix",
    model: "seedance",
    operation: "submit",
    requestPayload: { prompt: "完整商品视频" },
    submittedAt: "2026-07-26T00:00:00.000Z",
  });
  store.progress({ auditId: begun.id, providerTaskId: "provider-1", status: "processing" });
  store.complete({
    auditId: begun.id,
    status: "succeeded",
    responsePayload: { status: "done" },
    assetIds: ["asset-1"],
    completedAt: "2026-07-26T00:00:03.000Z",
  });
  expect(store.get(begun.id)).toMatchObject({ providerTaskId: "provider-1", durationMs: 3000, assetIds: ["asset-1"] });
});
```

- [ ] **Step 2: Run Store tests and verify RED**

Run: `bun test tests/unit/provider-generation-audit-store.test.ts`
Expected: FAIL because the schema and Store do not exist.

- [ ] **Step 3: Add the Drizzle table and Store**

Add a `providerGenerationAudits` `sqliteTable` with UUID/text fields from the approved design, a unique index on `(jobId, capability, operation)`, indexes on owner/provider/status/submitted time, and foreign keys to `users` and `jobs` where compatible with current deletion rules.

Implement:

```ts
export class ProviderGenerationAuditStore {
  begin(input: BeginProviderGenerationAuditInput): ProviderGenerationAuditDetail;
  progress(input: ProgressProviderGenerationAuditInput): ProviderGenerationAuditDetail | undefined;
  complete(input: CompleteProviderGenerationAuditInput): ProviderGenerationAuditDetail | undefined;
  list(input: ProviderGenerationAuditListInput): ProviderGenerationAuditListResult;
  get(id: string): ProviderGenerationAuditDetail | undefined;
  close(): void;
}
```

Use Drizzle `insert().onConflictDoUpdate()` for idempotent `begin`, recursive redaction before JSON serialization, and left joins to `users` for current phone/display name.

- [ ] **Step 4: Generate and validate the migration**

Run: `bun run db:generate && bun run db:check`
Expected: a new migration creates `provider_generation_audits` and all indexes; migration consistency passes.

- [ ] **Step 5: Run Store tests and verify GREEN**

Run: `bun test tests/unit/provider-generation-audit-store.test.ts`
Expected: PASS for lifecycle, idempotency, redaction, filtering, pagination, and deleted-user-compatible summaries.

- [ ] **Step 6: Commit**

```bash
git add server/db/schema.ts server/audit/provider-generation-audit-store.ts tests/unit/provider-generation-audit-store.test.ts drizzle
git commit -m "feat: persist provider generation audits"
```

### Task 2: Worker Audit Lifecycle Integration

**Files:**
- Modify: `worker/jobs/types.ts`
- Modify: `worker/job-processor.ts`
- Modify: `worker/index.ts`
- Create: `worker/jobs/provider-audit.ts`
- Modify: Provider-backed jobs under `worker/jobs/job-*.ts`
- Create: `tests/unit/provider-generation-audit-worker.test.ts`

**Interfaces:**
- Consumes: `ProviderGenerationAuditStore` from Task 1
- Produces: `JobHandlerContext.providerAudits?: ProviderGenerationAuditStore`
- Produces: `withProviderGenerationAudit(context, input, operation): Promise<T>`

- [ ] **Step 1: Write failing Worker lifecycle tests**

```ts
test("records original input and generated asset for a real provider job", async () => {
  await handler.execute(realProviderJob, contextWithAuditStore);
  expect(audits.list({ page: 1, pageSize: 25 }).audits[0]).toMatchObject({
    jobId: realProviderJob.id,
    ownerUserId: realProviderJob.ownerUserId,
    status: "succeeded",
    assetCount: 1,
  });
});

test("records structured provider failure but ignores mock jobs", async () => {
  await expect(realFailureHandler.execute(realJob, contextWithAuditStore)).resolves.toBeUndefined();
  expect(audits.list({ status: "failed", page: 1, pageSize: 25 }).total).toBe(1);
  await mockHandler.execute(mockJob, contextWithAuditStore);
  expect(audits.list({ page: 1, pageSize: 25 }).total).toBe(1);
});
```

- [ ] **Step 2: Run Worker tests and verify RED**

Run: `bun test tests/unit/provider-generation-audit-worker.test.ts`
Expected: FAIL because Worker context does not expose audit lifecycle recording.

- [ ] **Step 3: Wire the Store into Worker context**

Construct `ProviderGenerationAuditStore` in `worker/index.ts`, pass it through `JobProcessor`, and add it to `JobHandlerContext`. Implement safe helper methods that catch audit persistence errors and log them without replacing the Provider task result.

- [ ] **Step 4: Integrate every real material Provider path**

At each Provider-backed execution path call:

```ts
const audit = await beginProviderAudit(context, job, {
  capability,
  provider: "aihubmix",
  model,
  operation,
  requestPayload,
});
// progress when provider IDs become known
// complete with response/error and created asset IDs
```

Cover AIHubMix text/image/video/multimodal generation, Seedance task submission/recovery, Volc Speech voice generation/cloning, Qwen audio cloning/preview, and Volc MediaKit processing. Reused/recovered Provider tasks update the idempotent row. Ensure every real success has result data or asset IDs and every caught Provider error calls `complete(...status: "failed")`.

- [ ] **Step 5: Run Worker tests and verify GREEN**

Run: `bun test tests/unit/provider-generation-audit-worker.test.ts tests/unit/seedance-video-mock.test.ts tests/unit/qwen-voice-clone-api.test.ts`
Expected: PASS with real paths audited and Mock paths absent.

- [ ] **Step 6: Commit**

```bash
git add worker tests/unit/provider-generation-audit-worker.test.ts
git commit -m "feat: audit third-party generation lifecycle"
```

### Task 3: Administrator Audit API and Generated SDK

**Files:**
- Modify: `server/app.ts`
- Modify: `web/api/api-client.ts`
- Create: `tests/unit/admin-provider-audit-api.test.ts`
- Generate: `openapi/openapi.json`
- Generate: `web/api/generated/`

**Interfaces:**
- Consumes: `ProviderGenerationAuditStore.list()` and `.get()`
- Produces: `GET /api/admin/provider-audits`
- Produces: `GET /api/admin/provider-audits/{auditId}`
- Produces: `AdminProviderAudit`, `AdminProviderAuditDetail`, `fetchAdminProviderAudits`, `fetchAdminProviderAudit`

- [ ] **Step 1: Write failing OpenAPI and authorization tests**

```ts
test("publishes admin provider audit list and detail operations", async () => {
  const spec = await Bun.file("openapi/openapi.json").json();
  expect(spec.paths["/api/admin/provider-audits"]?.get?.operationId).toBe("listAdminProviderAudits");
  expect(spec.paths["/api/admin/provider-audits/{auditId}"]?.get?.operationId).toBe("getAdminProviderAudit");
});
```

Add request-level tests proving non-admin receives `403`, list filters are passed to Store, missing detail returns `404`, and detail assets include signed preview URLs when available.

- [ ] **Step 2: Run API tests and verify RED**

Run: `bun test tests/unit/admin-provider-audit-api.test.ts`
Expected: FAIL because routes and schemas are missing.

- [ ] **Step 3: Implement Hono OpenAPI routes**

Define list/detail Zod schemas near current admin schemas. Instantiate the audit Store with the shared database path. Apply `adminUser(c.get("userId"))` before reading records. Resolve each stored asset ID through the account/media store and reuse current signed-download response helpers; retain the ID and set preview availability false when the asset no longer exists.

- [ ] **Step 4: Generate OpenAPI and SDK**

Run: `bun run api:spec && bun run api:generate`
Expected: generated operations `listAdminProviderAudits` and `getAdminProviderAudit` exist without manual generated-file edits.

- [ ] **Step 5: Add API client domain wrappers**

Implement:

```ts
export type AdminProviderAudit = ListAdminProviderAuditsResponse["audits"][number];
export type AdminProviderAuditDetail = GetAdminProviderAuditResponse;

export async function fetchAdminProviderAudits(query: AdminProviderAuditQuery) {
  const { data } = await listAdminProviderAudits({ query, headers: authHeaders(), throwOnError: true });
  return data;
}

export async function fetchAdminProviderAudit(auditId: string) {
  const { data } = await getAdminProviderAudit({ path: { auditId }, headers: authHeaders(), throwOnError: true });
  return data;
}
```

- [ ] **Step 6: Run API tests and verify GREEN**

Run: `bun test tests/unit/admin-provider-audit-api.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/app.ts web/api/api-client.ts openapi web/api/generated tests/unit/admin-provider-audit-api.test.ts
git commit -m "feat: expose admin provider audit API"
```

### Task 4: Admin DataTable and Detail Dialog

**Files:**
- Modify: `web/features/admin/admin-page.tsx`
- Create: `web/features/admin/provider-audit-panel.tsx`
- Create: `tests/unit/admin-provider-audit-page.test.tsx`
- Modify: `tests/unit/admin-page.test.ts`

**Interfaces:**
- Consumes: API client types/functions from Task 3
- Consumes: `DataTable`, compact Dialog components, `MediaPreview`
- Produces: `ProviderAuditPanel`

- [ ] **Step 1: Write failing admin-page tests**

```ts
test("adds an audit log tab backed by the shared DataTable", async () => {
  const admin = await Bun.file("web/features/admin/admin-page.tsx").text();
  const panel = await Bun.file("web/features/admin/provider-audit-panel.tsx").text();
  expect(admin).toContain("审计日志");
  expect(panel).toContain('from "@/components/ui/data-table"');
  expect(panel).toContain("fetchAdminProviderAudits");
  expect(panel).toContain("fetchAdminProviderAudit");
  expect(panel).toContain("<MediaPreview");
});
```

Add component assertions for Provider/module/status/date filters, pagination reset on filter change, visible user/time/result columns, and title-only `DialogTitle`.

- [ ] **Step 2: Run UI tests and verify RED**

Run: `bun test tests/unit/admin-provider-audit-page.test.tsx tests/unit/admin-page.test.ts`
Expected: FAIL because the tab and panel are absent.

- [ ] **Step 3: Implement the audit panel**

Build a compact toolbar using `h-8` `Input`, `NativeSelect`, date inputs, refresh, and result count. Query with `["admin-provider-audits", page, filters]`; render shared `DataTable` with:

```ts
const columns: ColumnDef<AdminProviderAudit>[] = [
  { accessorKey: "submittedAt", header: "提交时间" },
  { id: "user", header: "用户" },
  { accessorKey: "moduleId", header: "模块" },
  { id: "provider", header: "Provider / 模型" },
  { accessorKey: "providerTaskId", header: "第三方任务" },
  { accessorKey: "status", header: "状态" },
  { accessorKey: "durationMs", header: "耗时" },
  { accessorKey: "assetCount", header: "结果" },
  { id: "actions", header: "操作" },
];
```

The detail Dialog fetches only when opened, formats request/response/error JSON, shows user/timeline identifiers, and maps result assets to `MediaPreview` using their MIME type and signed URL.

- [ ] **Step 4: Add the admin tab**

Extend `AdminPage` tab state with `"audits"`, add the “审计日志” ghost button, and render `<ProviderAuditPanel />` without a decorative card or subtitle.

- [ ] **Step 5: Run UI tests and verify GREEN**

Run: `bun test tests/unit/admin-provider-audit-page.test.tsx tests/unit/admin-page.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/features/admin tests/unit/admin-provider-audit-page.test.tsx tests/unit/admin-page.test.ts
git commit -m "feat: add provider audit admin table"
```

### Task 5: Coverage Audit and Full Verification

**Files:**
- Modify as required: Provider-backed `worker/jobs/job-*.ts`
- Modify: `DESIGN.md`
- Modify tests as required by uncovered paths

**Interfaces:**
- Consumes: all prior task deliverables
- Produces: verified complete audit coverage and documented admin pattern

- [ ] **Step 1: Enumerate third-party material calls**

Run:

```bash
rg -n "aihubmix\\.|volcSpeech\\.|qwenAudio\\.|volcMediaKit\\.|fetch\\(" worker/jobs server/providers
rg -n "beginProviderAudit|completeProviderAudit" worker/jobs
```

For every real material generation/processing call, prove it is wrapped by the audit lifecycle or document why it is a non-generation auxiliary request. Add a failing regression test for any uncovered generation path before integrating it.

- [ ] **Step 2: Update the design system**

Add the audit tab behavior to the existing `admin-page` component section in `DESIGN.md`: shared DataTable, compact filters, title-only detail Dialog, read-only JSON, and media previews.

- [ ] **Step 3: Run focused tests**

Run:

```bash
bun test tests/unit/provider-generation-audit-store.test.ts \
  tests/unit/provider-generation-audit-worker.test.ts \
  tests/unit/admin-provider-audit-api.test.ts \
  tests/unit/admin-provider-audit-page.test.tsx \
  tests/unit/admin-page.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run repository validation**

Run:

```bash
make ci
bun run typecheck
bun run build
bun run db:check
```

Expected: all new audit tests, typecheck, build, and migration checks pass. If existing unrelated tests fail, reproduce and report them separately without attributing them to this feature.

- [ ] **Step 5: Inspect final scope**

Run:

```bash
git status -sb
git diff --check
git diff --stat origin/main...HEAD
```

Verify no secrets, local artifacts, `.data`, or unrelated formatting changes are included.

- [ ] **Step 6: Commit and push `main`**

```bash
git add DESIGN.md
git commit -m "docs: document provider audit admin pattern"
git push origin main
```
