# Public Media CDN Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Return stable public CDN URLs for owned library media, use image previews without Blob conversion, and provide an idempotent production CDN setup and verification path.

**Architecture:** A focused server utility maps an existing TOS object key to an encoded original URL and, for images, a `style/preview` URL. API responses continue enforcing owner visibility but expose both preview and original URL semantics. The shared media component renders direct CDN URLs, opens originals in the lightbox, and downloads originals directly; relative protected URLs retain the current signed-access/Blob path. Production configuration requires the media CDN base URL, uses an exact CSP origin, and configures a private-TOS CDN domain with cache-key and Referer safeguards.

**Tech Stack:** Bun, TypeScript strict, Hono/OpenAPI/Zod, React 19, Happy DOM, Volcengine TOS/CDN/DNS APIs, Biome.

## Global Constraints

- Do not migrate, rename, copy, delete, or make public any existing object in `xbeacon-shanghai`.
- Keep API owner checks; a public URL is returned only after the authenticated API has selected an owned or otherwise authorized record.
- Local development without `PUBLIC_MEDIA_BASE_URL` keeps `/api/assets/{id}/content`.
- Production requires `PUBLIC_MEDIA_BASE_URL=https://files.xbeaconai.com`.
- Image preview URLs append `?x-tos-process=style/preview`; video and audio URLs use the original object URL.
- Full-screen preview and download use the original URL.
- Do not hand-edit `openapi/openapi.json` or `web/api/generated/`.
- Do not run E2E.
- Do not execute cloud mutations without explicit user approval for the production change.

---

### Task 1: Public media URL contract

**Files:**
- Create: `server/storage/public-media-url.ts`
- Modify: `server/env.ts`
- Modify: `.env.example`
- Test: `tests/unit/public-media-url.test.ts`
- Test: `tests/unit/tos-endpoint-config.test.ts`

**Interfaces:**
- Produces: `resolvePublicMediaConfig(input: { isProduction: boolean; baseUrl?: string }): { baseUrl?: string; origin?: string }`
- Produces: `publicMediaUrls(input: { baseUrl?: string; storageKey: string; mimeType: string; fallbackUrl: string }): { url: string; originalUrl: string }`

- [ ] **Step 1: Write failing URL and configuration tests**

```ts
expect(
  publicMediaUrls({
    baseUrl: "https://files.xbeaconai.com/",
    storageKey: "users/u 1/商品 主图.jpg",
    mimeType: "image/jpeg",
    fallbackUrl: "/api/assets/id/content",
  }),
).toEqual({
  url: "https://files.xbeaconai.com/users/u%201/%E5%95%86%E5%93%81%20%E4%B8%BB%E5%9B%BE.jpg?x-tos-process=style/preview",
  originalUrl: "https://files.xbeaconai.com/users/u%201/%E5%95%86%E5%93%81%20%E4%B8%BB%E5%9B%BE.jpg",
});
expect(() => resolvePublicMediaConfig({ isProduction: true })).toThrow("生产启动必须配置 PUBLIC_MEDIA_BASE_URL");
```

- [ ] **Step 2: Run the focused tests and confirm missing exports fail**

Run: `bun test ./tests/unit/public-media-url.test.ts ./tests/unit/tos-endpoint-config.test.ts`

Expected: FAIL because `public-media-url.ts` and the new production configuration do not exist.

- [ ] **Step 3: Implement strict base URL validation and per-segment key encoding**

```ts
export function publicMediaUrls(input: PublicMediaUrlInput) {
  if (!input.baseUrl) return { url: input.fallbackUrl, originalUrl: input.fallbackUrl };
  const key = input.storageKey.split("/").map(encodeURIComponent).join("/");
  const originalUrl = `${input.baseUrl.replace(/\/+$/, "")}/${key}`;
  return {
    url: input.mimeType.startsWith("image/") ? `${originalUrl}?x-tos-process=style/preview` : originalUrl,
    originalUrl,
  };
}
```

Add `PUBLIC_MEDIA_BASE_URL` to `env`, require HTTPS, reject credentials/query/hash, and require it in production.

- [ ] **Step 4: Run focused tests**

Run: `bun test ./tests/unit/public-media-url.test.ts ./tests/unit/tos-endpoint-config.test.ts`

Expected: PASS.

### Task 2: API response semantics and generated SDK

**Files:**
- Modify: `server/app.ts`
- Modify: `web/entities/types.ts`
- Generate: `openapi/openapi.json`
- Generate: `web/api/generated/`
- Test: `tests/integration/asset-api-isolated.test.ts`
- Test: `tests/unit/asset-tos-access.test.ts`

**Interfaces:**
- Consumes: `publicMediaUrls(...)`
- Produces: every `LibraryAsset` response has `url` and `originalUrl`

- [ ] **Step 1: Add failing API assertions**

```ts
expect(asset.url).toContain("?x-tos-process=style/preview");
expect(asset.originalUrl).not.toContain("x-tos-process");
```

Also assert video/audio `url === originalUrl`, and local fallback returns the same protected relative URL in both fields.

- [ ] **Step 2: Run the focused integration/unit tests**

Run: `bun test ./tests/integration/asset-api-isolated.test.ts ./tests/unit/asset-tos-access.test.ts`

Expected: FAIL because `originalUrl` is absent and responses still hard-code `/api/assets/.../content`.

- [ ] **Step 3: Route all library/product/upload response construction through one mapper**

Extend `LibraryAssetSchema`:

```ts
url: z.string(),
originalUrl: z.string(),
```

Use `publicMediaUrls` in `libraryAssetResponse`, `productResponse`, legacy upload responses, and any direct asset DTO construction. Keep `/api/assets/{assetId}/access` and `/content` for local fallback and compatibility.

- [ ] **Step 4: Generate the contract**

Run:

```bash
bun run api:spec
bun run api:generate
```

- [ ] **Step 5: Run focused tests**

Run: `bun test ./tests/integration/asset-api-isolated.test.ts ./tests/unit/asset-tos-access.test.ts`

Expected: PASS.

### Task 3: Direct preview, original lightbox, and original download

**Files:**
- Modify: `web/components/domain/media-preview.tsx`
- Modify: `web/api/api-client.ts`
- Modify: callers that pass `LibraryAsset` previews
- Test: `tests/unit/media-preview-component.test.tsx`
- Test: `tests/unit/public-media-download.test.ts`

**Interfaces:**
- Produces: `MediaPreviewProps.originalUrl?: string`
- Produces: `isDirectMediaUrl(url: string): boolean`
- Keeps: `downloadAuthenticated(url: string, name: string): Promise<void>`

- [ ] **Step 1: Add failing component and download tests**

```tsx
<MediaPreview
  url="https://files.xbeaconai.com/a.jpg?x-tos-process=style/preview"
  originalUrl="https://files.xbeaconai.com/a.jpg"
  mimeType="image/jpeg"
  alt="主图"
/>
```

Assert the card `<img>` uses the preview URL, the lightbox `<img>` uses the original URL, neither path calls `URL.createObjectURL`, and direct download clicks an anchor whose `href` is the original CDN URL.

- [ ] **Step 2: Run focused tests and confirm the new behavior fails**

Run: `bun test ./tests/unit/media-preview-component.test.tsx ./tests/unit/public-media-download.test.ts`

Expected: FAIL because `originalUrl` and direct CDN handling do not exist.

- [ ] **Step 3: Implement direct URL selection**

```ts
const direct = /^https:\/\/files\.xbeaconai\.com(?:\/|$)/.test(url);
const previewSource = useMediaSource(url, authenticated && !direct);
const originalSource = useMediaSource(originalUrl ?? url, authenticated && !isDirectMediaUrl(originalUrl ?? url));
```

Use the original source only in `MediaLightbox`. Preserve protected relative URL behavior and cleanup of Blob object URLs.

- [ ] **Step 4: Bypass Blob downloads only for the approved CDN**

For `https://files.xbeaconai.com/...`, create/click a direct anchor. Continue using `authenticatedBlobUrl` for protected API URLs and all other sources.

- [ ] **Step 5: Pass `originalUrl` from library/product UI call sites**

Update asset library, attachment picker, product picker, and other `LibraryAsset` consumers. Do not change generated artifact previews that do not carry the library contract.

- [ ] **Step 6: Run focused tests**

Run: `bun test ./tests/unit/media-preview-component.test.tsx ./tests/unit/public-media-download.test.ts`

Expected: PASS.

### Task 4: CSP, Referrer policy, and deployment configuration

**Files:**
- Modify: `server/app.ts`
- Modify: `deploy.sh`
- Modify: `.env.example`
- Test: `tests/unit/security-headers.test.ts`
- Test: `tests/unit/worker-concurrency-pools.test.ts`

**Interfaces:**
- Consumes: `env.publicMedia.origin`
- Produces: a CSP that permits only the configured media CDN in `img-src` and `media-src`

- [ ] **Step 1: Add failing header/deploy assertions**

```ts
expect(csp).toContain("img-src 'self' data: blob: https://files.xbeaconai.com");
expect(csp).toContain("media-src 'self' blob: https://files.xbeaconai.com");
expect(csp).not.toContain("img-src 'self' data: blob: https:");
expect(referrerPolicy).toBe("strict-origin-when-cross-origin");
expect(deploy).toContain('upsert_env "PUBLIC_MEDIA_BASE_URL" "https://files.xbeaconai.com"');
```

- [ ] **Step 2: Run focused tests**

Run: `bun test ./tests/unit/security-headers.test.ts ./tests/unit/worker-concurrency-pools.test.ts`

Expected: FAIL because CSP is broad for images, blocks CDN media, and `no-referrer` is incompatible with a non-empty Referer whitelist.

- [ ] **Step 3: Build headers from the validated configured origin**

Replace `Referrer-Policy: no-referrer` with `strict-origin-when-cross-origin`. Add only `env.publicMedia.origin` to the two media directives. Keep script, style, frame, base, and form restrictions unchanged.

- [ ] **Step 4: Add production env wiring**

Set `PUBLIC_MEDIA_BASE_URL=https://files.xbeaconai.com` in `deploy.sh` and document the value in `.env.example`.

- [ ] **Step 5: Run focused tests**

Run: `bun test ./tests/unit/security-headers.test.ts ./tests/unit/worker-concurrency-pools.test.ts`

Expected: PASS.

### Task 5: Idempotent media CDN setup and live verifier

**Files:**
- Create: `scripts/setup-media-cdn.ts`
- Create: `scripts/check-media-cdn.ts`
- Modify: `package.json`
- Test: `tests/unit/media-cdn-config.test.ts`

**Interfaces:**
- Produces: `setup:media:cdn`
- Produces: `check:media:cdn`
- Uses: `MEDIA_CDN_DOMAIN=files.xbeaconai.com`, `TOS_BUCKET=xbeacon-shanghai`, `TOS_REGION=cn-shanghai`

- [ ] **Step 1: Add failing source-contract tests**

Assert the setup script:

- configures a private TOS origin with `PrivateBucketAccess: true`;
- preserves `x-tos-process` in the cache key;
- enables a Referer whitelist for `app.xbeaconai.com` and approved localhost origins while rejecting empty Referer;
- configures long 2xx cache and non-long-lived 4xx/5xx cache;
- enables HTTPS and does not change Bucket ACL to public.

Assert the verifier checks DNS/CNAME, TLS, image WebP/dimensions, video `Range: bytes=0-15` returning `206`, allowed Referer success, empty Referer rejection, and distinct original/preview cache behavior.

- [ ] **Step 2: Run the test and confirm scripts are missing**

Run: `bun test ./tests/unit/media-cdn-config.test.ts`

Expected: FAIL because the setup/verifier scripts and package commands do not exist.

- [ ] **Step 3: Implement the idempotent setup script**

Reuse `callVolcOpenApi` and the safe existing-domain/DNS conflict checks from `scripts/setup-web-cdn.ts`. Read before write, reject unexpected existing DNS/origin settings, and print a diff-style summary. Require an explicit `--apply`; default mode performs read-only validation.

- [ ] **Step 4: Implement the live verifier**

Require explicit sample object keys:

```bash
MEDIA_CDN_IMAGE_KEY=... MEDIA_CDN_VIDEO_KEY=... bun run check:media:cdn
```

Do not print credentials or signed URLs. Return non-zero on any missing invariant.

- [ ] **Step 5: Run source-contract tests**

Run: `bun test ./tests/unit/media-cdn-config.test.ts`

Expected: PASS.

### Task 6: Full local verification and cloud handoff

**Files:**
- Review: all changed files

- [ ] **Step 1: Run task-focused tests**

Run:

```bash
bun test ./tests/unit/public-media-url.test.ts \
  ./tests/unit/tos-endpoint-config.test.ts \
  ./tests/integration/asset-api-isolated.test.ts \
  ./tests/unit/asset-tos-access.test.ts \
  ./tests/unit/media-preview-component.test.tsx \
  ./tests/unit/public-media-download.test.ts \
  ./tests/unit/security-headers.test.ts \
  ./tests/unit/worker-concurrency-pools.test.ts \
  ./tests/unit/media-cdn-config.test.ts
```

- [ ] **Step 2: Run repository delivery baseline**

Run:

```bash
make ci
bun run typecheck
bun run build
git diff --check
```

- [ ] **Step 3: Review scope**

Run: `git status --short && git diff --stat && git diff`

Confirm no `.env`, credentials, `.data`, `dist`, or unrelated user changes were added.

- [ ] **Step 4: Perform read-only cloud inspection**

Run the setup command without `--apply`; record DNS/CDN/TLS gaps without changing cloud state.

- [ ] **Step 5: Stop for production mutation approval**

Before `bun run setup:media:cdn -- --apply`, present the exact domain, Bucket, origin, Referer, cache-key, HTTPS, and expected billable CDN scope. After approval, apply and run `check:media:cdn`, then verify one real authenticated asset API response.
