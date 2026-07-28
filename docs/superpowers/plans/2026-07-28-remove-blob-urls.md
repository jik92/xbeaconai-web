# Remove Blob URLs and Use CDN Media Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every user-facing `blob:` URL from the Web application, load all persisted media from the exact CDN origin, and move non-media downloads to short-lived server attachment URLs.

**Architecture:** Persisted image, audio, and video URLs come from the existing owner-checked API mapping to `https://files.xbeaconai.com`. Local files do not receive a browser preview until TOS upload completes. Text and sensitive downloads use a short-lived signed download ticket whose public endpoint returns `Content-Disposition: attachment`; sensitive data never enters TOS or CDN.

**Tech Stack:** Bun, TypeScript strict, React 19, Hono, `@hono/zod-openapi`, Hono JWT, TOS direct upload, Volcengine CDN, Bun Test.

## Global Constraints

- Do not hand-edit `web/api/generated/` or `openapi/openapi.json`; regenerate them with the project commands.
- Do not put `.env.key`, logs, Markdown, or generated text on TOS/CDN.
- Do not add a Data URL fallback.
- Do not change owner isolation or trust a user ID supplied by the client.
- Do not retain a Blob compatibility fallback when TOS/CDN is unavailable.
- Preserve unrelated working-tree changes and stage only task files.
- Use TDD for every behavior change.
- Do not run E2E tests.

---

### Task 1: Make media rendering direct-only

**Files:**
- Modify: `web/api/api-client.ts:1214-1255`
- Modify: `web/components/domain/media-preview.tsx:1-190`
- Modify: `tests/unit/media-preview-component.test.tsx`
- Modify: `tests/unit/public-media-download.test.ts`

**Interfaces:**
- Consumes: `isPublicMediaUrl(url: string): boolean`
- Produces: `directMediaSource(url: string): string | undefined`
- Produces: `downloadDirectUrl(url: string, name: string): void`

- [ ] **Step 1: Write failing direct-media tests**

Add assertions that public CDN media is returned unchanged, non-CDN media has no renderable source, and direct CDN download does not call `fetch`, `URL.createObjectURL`, or `URL.revokeObjectURL`.

```ts
expect(directMediaSource("https://files.xbeaconai.com/u/video.mp4")).toBe(
  "https://files.xbeaconai.com/u/video.mp4",
);
expect(directMediaSource("/api/assets/00000000-0000-4000-8000-000000000000/content")).toBeUndefined();
expect(source).not.toContain("authenticatedBlobUrl");
expect(source).not.toContain("URL.createObjectURL");
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
bun test ./tests/unit/media-preview-component.test.tsx ./tests/unit/public-media-download.test.ts
```

Expected: FAIL because `directMediaSource` does not exist and `MediaPreview` still calls `authenticatedBlobUrl`.

- [ ] **Step 3: Implement direct-only rendering**

Replace `authenticatedBlobUrl` and its Blob lifecycle with:

```ts
export function directMediaSource(url: string) {
  return isPublicMediaUrl(url) ? url : undefined;
}

export function downloadDirectUrl(url: string, name: string) {
  if (!isPublicMediaUrl(url)) throw new Error("媒体文件未使用受信任的 CDN 地址");
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
}
```

Make `MediaPreview` render `directMediaSource(url)` directly. A non-CDN media URL must enter the existing error state without fetching the body or creating a fallback URL.

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
bun test ./tests/unit/media-preview-component.test.tsx ./tests/unit/public-media-download.test.ts
```

Expected: PASS with no Object URL calls.

- [ ] **Step 5: Commit the focused change**

```bash
git add web/api/api-client.ts web/components/domain/media-preview.tsx \
  tests/unit/media-preview-component.test.tsx tests/unit/public-media-download.test.ts
git commit -m "refactor: render persisted media directly from CDN"
```

### Task 2: Remove local file Blob previews and hydrate the video editor from CDN

**Files:**
- Modify: `web/components/domain/file-upload.tsx:1-280`
- Modify: `web/features/video-editor/video-editor-page.tsx:1-200`
- Modify: `shared/video-editor/timeline.ts:30-48`
- Modify: `tests/unit/file-upload.test.tsx`
- Modify: `tests/unit/video-editor-timeline.test.ts`
- Create: `tests/unit/video-editor-cdn-source.test.ts`

**Interfaces:**
- Consumes: `uploadMediaFile(file, folderId?, onProgress?) => Promise<LibraryAsset>`
- Consumes: `LibraryAsset.url` and `LibraryAsset.originalUrl`
- Produces: a timeline whose `VideoEditorSource.url` is an exact CDN URL

- [ ] **Step 1: Write failing upload and editor tests**

Assert that `FileUpload` does not preview pending `File` objects, and that the editor uploads before metadata probing.

```ts
expect(fileUploadSource).not.toContain("URL.createObjectURL");
expect(fileUploadSource).not.toContain("localUrls");
expect(editorSource.indexOf("await uploadMediaFile(file)")).toBeLessThan(
  editorSource.indexOf("await mediaMetadata("),
);
expect(editorSource).toContain("asset.originalUrl");
```

Update timeline normalization expectations so a stored CDN URL is preserved while a legacy `/api/assets/.../content` URL becomes empty and never becomes `blob:`.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
bun test ./tests/unit/file-upload.test.tsx ./tests/unit/video-editor-timeline.test.ts \
  ./tests/unit/video-editor-cdn-source.test.ts
```

Expected: FAIL because pending files still use Object URLs and editor metadata is read before upload.

- [ ] **Step 3: Implement pending-file metadata-only UI**

Delete `localUrls` and its effect from `FileUpload`. Keep the pending-file card, file name, size, upload progress, retry, clear, and validation states. Only `uploadedFiles` with a CDN `url` may render media.

- [ ] **Step 4: Implement upload-first editor flow**

For each selected video:

```ts
const asset = await uploadMediaFile(file);
const cdnUrl = asset.originalUrl;
if (!isPublicMediaUrl(cdnUrl)) throw new Error("视频上传完成，但未返回 CDN 地址");
const metadata = await mediaMetadata(cdnUrl);
```

Store `cdnUrl` in the timeline and pass timeline source URLs directly to Remotion. Remove `previewUrls`, `authenticatedBlobUrl`, and every URL revocation effect. Normalize legacy non-CDN timeline URLs to `""`.

- [ ] **Step 5: Run tests and verify GREEN**

Run:

```bash
bun test ./tests/unit/file-upload.test.tsx ./tests/unit/video-editor-timeline.test.ts \
  ./tests/unit/video-editor-cdn-source.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the focused change**

```bash
git add web/components/domain/file-upload.tsx web/features/video-editor/video-editor-page.tsx \
  shared/video-editor/timeline.ts tests/unit/file-upload.test.tsx \
  tests/unit/video-editor-timeline.test.ts tests/unit/video-editor-cdn-source.test.ts
git commit -m "refactor: upload media before previewing from CDN"
```

### Task 3: Add short-lived attachment download tickets

**Files:**
- Create: `server/downloads/download-ticket.ts`
- Create: `tests/unit/download-ticket.test.ts`
- Modify: `server/uploads/content-disposition.ts`
- Modify: `tests/unit/content-disposition.test.ts`
- Modify: `server/app.ts`
- Create: `tests/integration/attachment-download-api-isolated.test.ts`
- Modify: `openapi/openapi.json` via generation
- Modify: `web/api/generated/` via generation

**Interfaces:**
- Produces: `issueDownloadTicket(input, secret) => Promise<{ token: string; expiresAt: string }>`
- Produces: `verifyDownloadTicket(token, secret) => Promise<DownloadTicket>`
- Produces: `attachmentUtf8ContentDisposition(fileName: string): string`
- Produces: `POST /api/downloads/tickets`
- Produces: `GET /api/downloads/{token}`

- [ ] **Step 1: Write the failing ticket unit test**

Define a discriminated ticket payload:

```ts
type DownloadResource =
  | { kind: "artifact"; artifactId: string }
  | { kind: "job-text"; jobId: string }
  | { kind: "ad-script"; projectId: string; variantId: string; versionId?: string; format: "txt" | "md" }
  | { kind: "admin-env" };
```

Test an issued ticket round-trips the authenticated subject and resource, expires after 60 seconds, rejects another signing secret, and rejects an unknown resource kind.

- [ ] **Step 2: Run the unit test and verify RED**

Run:

```bash
bun test ./tests/unit/download-ticket.test.ts
```

Expected: FAIL because `server/downloads/download-ticket.ts` does not exist.

- [ ] **Step 3: Implement the signed ticket module**

Use Hono JWT with exact issuer and audience:

```ts
const issuer = "yaozuo-download";
const audience = "yaozuo-browser-attachment";
const ttlSeconds = 60;
```

The payload contains only `purpose`, `sub`, the discriminated resource descriptor, `iat`, `exp`, `iss`, and `aud`. It must never contain file contents, credentials, TOS keys, or arbitrary paths.

- [ ] **Step 4: Run the ticket test and verify GREEN**

Run:

```bash
bun test ./tests/unit/download-ticket.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing attachment API integration tests**

Cover:

- a user can issue and use a ticket only for an owned artifact/job/ad-script;
- an administrator can export `.env.key`;
- a non-administrator cannot issue an admin export ticket;
- an invalid or expired ticket returns 404 without revealing why;
- attachment responses set `Content-Disposition: attachment`, `Cache-Control: no-store`, and `Referrer-Policy: no-referrer`;
- media artifacts return a CDN URL from the normal media API and are rejected by the attachment-ticket request.

- [ ] **Step 6: Run the integration test and verify RED**

Run:

```bash
bun test ./tests/integration/attachment-download-api-isolated.test.ts
```

Expected: FAIL because the two routes are absent.

- [ ] **Step 7: Implement ticket issue and redemption routes**

The authenticated POST validates ownership before signing:

```ts
const DownloadTicketRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("artifact"), artifactId: z.string().uuid() }),
  z.object({ kind: z.literal("job-text"), jobId: z.string().uuid() }),
  z.object({
    kind: z.literal("ad-script"),
    projectId: z.string().uuid(),
    variantId: z.string().uuid(),
    versionId: z.string().uuid().optional(),
    format: z.enum(["txt", "md"]),
  }),
  z.object({ kind: z.literal("admin-env") }),
]);
```

The public GET verifies the signature and re-checks the resource against `ticket.sub`. It returns server-side content with an encoded filename and:

```ts
{
  "Content-Disposition": attachmentUtf8ContentDisposition(fileName),
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
}
```

Add only `/api/downloads/{token}` to the dynamic public-path matcher. Never make the ticket issue route public.

- [ ] **Step 8: Generate API contract and verify GREEN**

Run:

```bash
bun run api:spec
bun run api:generate
bun test ./tests/unit/download-ticket.test.ts \
  ./tests/integration/attachment-download-api-isolated.test.ts
```

Expected: generation succeeds and both suites pass.

- [ ] **Step 9: Commit the focused change**

```bash
git add server/downloads/download-ticket.ts server/app.ts server/uploads/content-disposition.ts \
  tests/unit/download-ticket.test.ts tests/unit/content-disposition.test.ts \
  tests/integration/attachment-download-api-isolated.test.ts \
  openapi/openapi.json web/api/generated
git commit -m "feat: add secure browser attachment downloads"
```

### Task 4: Migrate all browser downloads away from Blob URLs

**Files:**
- Modify: `web/api/api-client.ts`
- Modify: `web/components/domain/module-page.tsx`
- Modify: `web/features/ai-creation/ai-creation-composer.tsx`
- Modify: `web/features/admin/admin-page.tsx`
- Modify: `web/features/ai-generate/ai-generate-page.tsx`
- Modify: `web/features/video-create/video-create-page.tsx`
- Modify: `web/features/video-mashup/video-mashup-page.tsx`
- Create: `tests/unit/attachment-download-client.test.ts`
- Modify: `tests/unit/admin-page.test.ts`

**Interfaces:**
- Consumes: `POST /api/downloads/tickets`
- Produces: `downloadAttachment(resource: DownloadResource): Promise<void>`
- Consumes: `downloadDirectUrl(url, name)` for CDN media

- [ ] **Step 1: Write failing client download tests**

Assert that the client requests a ticket using Bearer authentication and then clicks the returned same-origin URL:

```ts
await downloadAttachment({ kind: "job-text", jobId });
expect(fetch).toHaveBeenCalledWith(
  expect.stringContaining("/api/downloads/tickets"),
  expect.objectContaining({ method: "POST" }),
);
expect(clickedHref).toMatch(/\/api\/downloads\/[^/]+$/);
```

Add source assertions that the named call sites contain neither `new Blob` nor `URL.createObjectURL`.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
bun test ./tests/unit/attachment-download-client.test.ts ./tests/unit/admin-page.test.ts
```

Expected: FAIL because downloads are assembled in the browser.

- [ ] **Step 3: Implement the client helper**

`downloadAttachment` posts the typed resource descriptor, receives `{ url, expiresAt }`, creates an anchor pointing to `apiUrl(url)`, clicks it, and removes it. It must not fetch the attachment body.

Keep media behavior separate:

```ts
if (artifact.url && isPublicMediaUrl(artifact.url)) {
  downloadDirectUrl(artifact.originalUrl ?? artifact.url, artifact.name);
} else {
  await downloadAttachment({ kind: "job-text", jobId: task.id });
}
```

- [ ] **Step 4: Replace every browser-generated download**

- Ad-script TXT/MD uses `{ kind: "ad-script", ... }`.
- Admin `.env.key` uses `{ kind: "admin-env" }`.
- Module and AI creation text results use `{ kind: "job-text", jobId }`.
- Persisted media uses the exact CDN original URL.
- Persisted non-media artifact uses `{ kind: "artifact", artifactId }`.

Remove `fetchAdminEnvKeyExport`, browser text concatenation, `authenticatedBlobUrl`, and `downloadAuthenticated` once no caller remains.

- [ ] **Step 5: Run tests and verify GREEN**

Run:

```bash
bun test ./tests/unit/attachment-download-client.test.ts ./tests/unit/admin-page.test.ts \
  ./tests/unit/public-media-download.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the focused change**

```bash
git add web/api/api-client.ts web/components/domain/module-page.tsx \
  web/features/ai-creation/ai-creation-composer.tsx web/features/admin/admin-page.tsx \
  web/features/ai-generate/ai-generate-page.tsx web/features/video-create/video-create-page.tsx \
  web/features/video-mashup/video-mashup-page.tsx tests/unit/attachment-download-client.test.ts \
  tests/unit/admin-page.test.ts
git commit -m "refactor: download attachments without Blob URLs"
```

### Task 5: Replace remaining protected media call sites with CDN fields

**Files:**
- Modify: `web/components/domain/attachment-picker.tsx`
- Modify: `web/components/domain/product-image.tsx`
- Modify: `web/features/asset-library/asset-library.tsx`
- Modify: `web/features/video-create/video-create-page.tsx`
- Modify: `web/features/video-create/video-create-material-history-dialog.tsx`
- Modify: `web/features/video-create/video-create-shot-generation-dialog.tsx`
- Modify: `web/features/video-mashup/video-mashup-page.tsx`
- Modify: `web/features/video-remix/remix-project.tsx`
- Modify: affected API response mapping in `server/app.ts`
- Modify: affected component tests under `tests/unit/`

**Interfaces:**
- Consumes: `LibraryAsset.url` for image preview
- Consumes: `LibraryAsset.originalUrl` for video/audio playback, metadata, fullscreen, and download
- Produces: no `/api/assets/{id}/content` media source in Web JSX

- [ ] **Step 1: Write failing contract and source tests**

Add assertions for each feature that media elements receive `asset.url` or `asset.originalUrl`, never a constructed content route:

```ts
expect(source).not.toMatch(/\\/api\\/assets\\/.*\\/content/);
expect(source).not.toContain("authenticated={true}");
```

Add API integration assertions that all owner-visible asset and project-media shapes include exact CDN `url` and `originalUrl` fields.

- [ ] **Step 2: Run targeted tests and verify RED**

Run:

```bash
bun test ./tests/unit/attachment-picker-preview.test.ts \
  ./tests/unit/media-preview-component.test.tsx \
  ./tests/unit/video-create-actions.test.ts \
  ./tests/unit/video-remix-source-preview.test.ts \
  ./tests/integration/asset-public-media-api-isolated.test.ts
```

Expected: FAIL at the remaining constructed protected-media URLs.

- [ ] **Step 3: Update server response mappings**

Use `publicMediaUrls(...)` at the owner-checked response boundary for every media DTO. Do not emit a signed TOS address, local result path, or content route when `PUBLIC_MEDIA_BASE_URL` is configured.

- [ ] **Step 4: Update every media call site**

Pass the DTO fields directly:

```tsx
<AuthenticatedMedia
  url={asset.mimeType.startsWith("image/") ? asset.url : asset.originalUrl}
  originalUrl={asset.originalUrl}
  mimeType={asset.mimeType}
  alt={asset.name}
/>
```

Do not construct a URL from only an asset ID. If a caller has only an ID, expand its server DTO to include the owner-checked media fields.

- [ ] **Step 5: Regenerate contract when DTOs change**

Run:

```bash
bun run api:spec
bun run api:generate
```

- [ ] **Step 6: Run targeted tests and verify GREEN**

Run the same command from Step 2. Expected: PASS.

- [ ] **Step 7: Commit the focused change**

Stage only the files changed in this task and generated contract files:

```bash
git add server/app.ts web/components/domain web/features/asset-library \
  web/features/video-create web/features/video-mashup web/features/video-remix \
  tests/unit tests/integration/asset-public-media-api-isolated.test.ts \
  openapi/openapi.json web/api/generated
git commit -m "refactor: use CDN fields at every media call site"
```

Before committing, inspect `git diff --cached --name-only` and unstage unrelated test files because the working tree already contains user changes.

### Task 6: Enforce a Blob-free Web and CSP

**Files:**
- Create: `tests/unit/no-web-blob-url.test.ts`
- Modify: `server/http/security-headers.ts`
- Modify: `tests/unit/security-headers.test.ts`
- Modify: tests that intentionally use `blob:` fixtures

**Interfaces:**
- Produces: a repository guard against `URL.createObjectURL`, `URL.revokeObjectURL`, and the `blob:` scheme in `web/`
- Produces: CSP without `blob:` in `img-src` or `media-src`

- [ ] **Step 1: Write the failing repository guard**

Scan production Web source only:

```ts
const forbidden = ["URL.createObjectURL", "URL.revokeObjectURL", "blob:"];
for (const file of new Bun.Glob("web/**/*.{ts,tsx}").scanSync()) {
  const source = await Bun.file(file).text();
  for (const token of forbidden) expect(source, `${file} contains ${token}`).not.toContain(token);
}
```

Update CSP expectations:

```ts
expect(csp).toContain("img-src 'self' data: https://files.xbeaconai.com");
expect(csp).toContain("media-src 'self' https://files.xbeaconai.com");
expect(csp).not.toContain("blob:");
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
bun test ./tests/unit/no-web-blob-url.test.ts ./tests/unit/security-headers.test.ts
```

Expected: FAIL and list every remaining production Web source occurrence.

- [ ] **Step 3: Remove the remaining occurrences**

Remove all remaining Object URL creation/revocation, Blob URL fixtures in production code, and Blob CSP sources. Do not change `scripts/check-media-cdn.ts` because its Node-side `Blob` is an ffprobe stdin buffer and never creates a browser URL.

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
bun test ./tests/unit/no-web-blob-url.test.ts ./tests/unit/security-headers.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run a raw audit**

Run:

```bash
rg -n 'createObjectURL|revokeObjectURL|blob:' web server/http/security-headers.ts
```

Expected: no output.

- [ ] **Step 6: Commit the policy**

```bash
git add tests/unit/no-web-blob-url.test.ts server/http/security-headers.ts \
  tests/unit/security-headers.test.ts
git commit -m "test: enforce Blob-free browser media"
```

### Task 7: Full verification and production handoff

**Files:**
- Review: every task file
- Review: `.env.example`
- Review: `deploy.sh`

**Interfaces:**
- Consumes: the complete Blob-free CDN implementation
- Produces: verified build and an explicit deployment boundary

- [ ] **Step 1: Run focused regression suites**

```bash
bun test ./tests/unit/no-web-blob-url.test.ts \
  ./tests/unit/media-preview-component.test.tsx \
  ./tests/unit/public-media-download.test.ts \
  ./tests/unit/file-upload.test.tsx \
  ./tests/unit/video-editor-timeline.test.ts \
  ./tests/unit/download-ticket.test.ts \
  ./tests/unit/attachment-download-client.test.ts \
  ./tests/unit/security-headers.test.ts \
  ./tests/integration/asset-public-media-api-isolated.test.ts \
  ./tests/integration/attachment-download-api-isolated.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run the repository baseline**

```bash
make ci
bun run typecheck
bun run build
```

Expected: all pass. If `make ci` still reports only the pre-existing formatting issue in `tests/unit/douyin-db-migration.test.ts`, record it separately and do not modify that unrelated file.

- [ ] **Step 3: Audit generated and source changes**

```bash
git diff --check
git status --short
git diff --stat
rg -n 'createObjectURL|revokeObjectURL|blob:' web server/http/security-headers.ts
```

Expected: no diff whitespace errors and no Blob URL occurrence in Web or CSP.

- [ ] **Step 4: Verify the live CDN independently**

```bash
MEDIA_CDN_IMAGE_KEY='74631de1-9e42-4cca-9a99-679edc8f8bb6/materials/316017b4-c48b-4525-a640-29b90e715fcc/ef97abaf-ac12-45f3-a9ad-3e9c76cd8179.jpg' \
MEDIA_CDN_VIDEO_KEY='74631de1-9e42-4cca-9a99-679edc8f8bb6/materials/febeff7d-872b-4a03-b3dc-f628ebf2b23e/generated/ed5f1908-da5c-4fc8-8f91-41cd1631217e/13429004780004041-生成-ed5f1908.mp4' \
bun run check:media:cdn
```

Expected: image WebP, video `206`, and empty Referer `403`.

- [ ] **Step 5: Stop before production deployment**

Report code verification separately from deployment. Do not run `deploy.sh`, restart production, or publish uncommitted work unless the user explicitly authorizes production deployment.
