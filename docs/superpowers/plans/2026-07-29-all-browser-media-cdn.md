# All Browser Media CDN Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every browser-loaded business image, audio file, and video use `files.xbeaconai.com`, with separate thumbnail, preview, and original image URLs.

**Architecture:** Extend the existing public-media URL contract to three variants, mirror system catalogs into the production media Bucket, and make browser APIs return CDN metadata instead of bytes, signed TOS URLs, Blob URLs, or Data URLs. Keep provider-facing upstream URLs internal so the CDN Referer policy does not break model requests.

**Tech Stack:** Bun, TypeScript, Hono OpenAPI, React 19, TOS SDK, Volcengine CDN, Bun Test.

## Global Constraints

- Browser business media must use the exact `https://files.xbeaconai.com` origin.
- Static UI chrome such as `/logo.png` may remain on the `app.xbeaconai.com` Web CDN.
- Thumbnail images use a WebP transformation with a maximum 320px edge.
- Preview images use `?x-tos-process=style/preview`, WebP, with a maximum 1280px edge.
- Full-screen images and downloads use the original CDN object URL.
- Audio and video use the original CDN URL and retain Range support.
- Do not retain legacy browser media loading through `/api/.../content`.
- Do not run E2E unless the user explicitly asks.

---

### Task 1: Three-Level Public Media URL Contract

**Files:**
- Modify: `server/storage/public-media-url.ts`
- Modify: `server/app.ts`
- Modify: `web/entities/types.ts`
- Test: `tests/unit/public-media-url.test.ts`

**Interfaces:**
- Produces: `publicMediaUrls(input): { thumbnailUrl: string; url: string; originalUrl: string }`
- Images: `thumbnailUrl` uses `style/thumbnail`, `url` uses `style/preview`, and `originalUrl` has no processing query.
- Audio/video: all three fields equal the original URL.

- [x] **Step 1: Write the failing URL contract tests**

```ts
expect(publicMediaUrls({
  baseUrl: "https://files.xbeaconai.com",
  storageKey: "users/u 1/photo.png",
  mimeType: "image/png",
  fallbackUrl: "/api/assets/id/content",
})).toEqual({
  thumbnailUrl: "https://files.xbeaconai.com/users/u%201/photo.png?x-tos-process=style/thumbnail",
  url: "https://files.xbeaconai.com/users/u%201/photo.png?x-tos-process=style/preview",
  originalUrl: "https://files.xbeaconai.com/users/u%201/photo.png",
});
```

- [x] **Step 2: Run `bun test tests/unit/public-media-url.test.ts` and verify the missing `thumbnailUrl` failure**
- [x] **Step 3: Add `thumbnailUrl` without duplicating object-key encoding**
- [x] **Step 4: Add `thumbnailUrl` to API schemas and `LibraryAsset`**
- [x] **Step 5: Run `bun test tests/unit/public-media-url.test.ts tests/integration/asset-public-media-api-isolated.test.ts`**

### Task 2: System Portrait and Scene CDN Catalog

**Files:**
- Create: `shared/media/system-media.ts`
- Modify: `server/portraits/catalog.ts`
- Modify: `web/features/portrait-library/portrait-data.ts`
- Modify: `shared/scenes/scene-catalog.ts`
- Modify: `web/features/scene-library/scene-library.tsx`
- Test: `tests/unit/system-media.test.ts`
- Test: `tests/unit/portrait-data.test.ts`
- Test: `tests/unit/scene-catalog.test.ts`

**Interfaces:**
- Produces: `systemPortraitMedia(portraitId)` and `systemSceneMedia(sceneId)`.
- Each function returns `{ thumbnailUrl, url, originalUrl, storageKey }` using stable `system/` keys.
- `Portrait` gains `thumbnail_url` and `original_url`; upstream `source_url` remains for provider requests but is never rendered.
- `SceneCatalogEntry` gains `thumbnailUrl` and `originalUrl`; `sourceUrl` remains provider-only.

- [x] **Step 1: Write failing literal URL tests for portrait 3 and scene 9**

```ts
expect(systemPortraitMedia(3)).toEqual({
  storageKey: "system/portraits/3.png",
  thumbnailUrl: "https://files.xbeaconai.com/system/portraits/3.png?x-tos-process=style/thumbnail",
  url: "https://files.xbeaconai.com/system/portraits/3.png?x-tos-process=style/preview",
  originalUrl: "https://files.xbeaconai.com/system/portraits/3.png",
});
```

- [x] **Step 2: Run the three targeted tests and verify they fail on API/local scene URLs**
- [x] **Step 3: Implement the shared system-media URL builder**
- [x] **Step 4: Map portrait and scene browser fields to CDN variants**
- [x] **Step 5: Use thumbnails in grids, previews in detail panels, and originals for full-screen/download**
- [x] **Step 6: Run the three targeted tests and confirm all catalog records resolve to the CDN**

### Task 3: Idempotent System Media Synchronization

**Files:**
- Create: `scripts/sync-system-media.ts`
- Modify: `package.json`
- Modify: `deploy.sh`
- Test: `tests/unit/system-media-sync.test.ts`

**Interfaces:**
- Produces: `systemMediaManifest()` with 1125 portrait entries and 47 scene entries.
- Produces: `syncSystemMedia({ apply, concurrency, head, fetchBytes, uploadBytes })`.
- Check mode reports all missing keys and exits non-zero.
- Apply mode uploads only missing objects, verifies every key, and never overwrites existing objects.

- [x] **Step 1: Write a failing test with one existing and two missing manifest entries**

```ts
expect(await syncSystemMedia({
  apply: true,
  entries,
  head: async (key) => key === "system/scenes/1.jpg",
  fetchBytes,
  uploadBytes,
})).toEqual({ checked: 3, uploaded: 2, missing: [] });
```

- [x] **Step 2: Verify the test fails because the synchronization module does not exist**
- [x] **Step 3: Implement bounded-concurrency check/apply behavior and MIME validation**
- [x] **Step 4: Add `media:system:sync` and `media:system:check` scripts**
- [x] **Step 5: Make `deploy.sh` apply the idempotent synchronization before the production build**
- [x] **Step 6: Run `bun test tests/unit/system-media-sync.test.ts`**

### Task 4: Remove Browser Blob and Data Media

**Files:**
- Modify: `web/components/domain/attachment-picker.tsx`
- Modify: `web/features/video-create/video-create-media-settings-dialogs.tsx`
- Modify: `server/app.ts`
- Modify: `web/api/api-client.ts`
- Test: `tests/unit/no-web-blob-url.test.ts`
- Test: `tests/unit/video-create-voice-preview.test.tsx`

**Interfaces:**
- Attachment constraints consume the `durationSec` returned by the completed upload, not a browser Object URL.
- Voice preview API returns `{ url: string, mimeType: "audio/mpeg" }`.
- Voice preview storage key is `ephemeral/voice-previews/{userId}/{sha256}.mp3`.

- [x] **Step 1: Keep the current Blob policy test red and add a failing voice preview test that rejects `audioBase64`**
- [x] **Step 2: Run both tests and record the Object URL and Data URL failures**
- [x] **Step 3: Remove `loadLocalVideoDuration`; validate uploaded assets using server-probed duration**
- [x] **Step 4: Hash the owner/settings/text, upload synthesis bytes with `putLibraryBytes`, and return `publicMediaUrls(...).originalUrl`**
- [x] **Step 5: Play `result.url` directly and reject non-CDN responses**
- [x] **Step 6: Run both targeted tests and the voice API contract test**

### Task 5: Admin Provider Audit Media Through CDN

**Files:**
- Modify: `server/app.ts`
- Modify: `web/api/api-client.ts`
- Modify: `web/features/admin/provider-audit-panel.tsx`
- Test: `tests/unit/admin-provider-audit-api.test.ts`
- Test: `tests/unit/admin-provider-audit-page.test.tsx`
- Test: `tests/integration/admin-provider-audit-media-api-isolated.test.ts`

**Interfaces:**
- Admin audit media access returns `{ thumbnailUrl, url, originalUrl }`.
- Local media artifacts reuse `persistArtifactMedia` under their owning user before returning URLs.
- Non-media audit artifacts remain attachment-only and are not passed to `MediaPreview`.

- [x] **Step 1: Write an integration test that expects an audit image URL on `files.xbeaconai.com`**
- [x] **Step 2: Verify the test fails on the current `/api/admin/provider-audits/.../assets/...` binary URL**
- [x] **Step 3: Add an admin-only CDN access route using the artifact owner and shared persistence helper**
- [x] **Step 4: Return CDN variants from audit detail and pass `originalUrl` into `MediaPreview`**
- [x] **Step 5: Remove the browser binary preview contract**
- [x] **Step 6: Run the three targeted audit tests**

### Task 6: Enforce Browser Media CDN Sources

**Files:**
- Modify: `tests/unit/no-web-blob-url.test.ts`
- Create: `tests/unit/browser-media-cdn-policy.test.ts`
- Modify: `web/api/api-client.ts`
- Modify: affected native media callers found by the policy test

**Interfaces:**
- `directMediaSource` accepts only exact `files.xbeaconai.com` media URLs.
- The policy scanner rejects `blob:`, `URL.createObjectURL`, media Data URLs, browser-visible third-party media hosts, and native media sources using `/api/.../content`.

- [ ] **Step 1: Add the policy scanner and verify it fails on remaining portrait/API/third-party/Data URL sources**
- [ ] **Step 2: Remove `isPublicPortraitMediaUrl` and API media direct-source exceptions**
- [ ] **Step 3: Convert each reported browser caller to CDN metadata or a static UI CDN path**
- [ ] **Step 4: Re-run the policy tests until no browser media exceptions remain**

### Task 7: Thumbnail Style and Production CDN Verification

**Files:**
- Modify: `scripts/check-media-cdn.ts`
- Modify: `scripts/setup-media-cdn.ts`
- Modify: `deploy.sh`
- Test: `tests/unit/media-cdn-config.test.ts`

**Interfaces:**
- `buildMediaCdnCheckUrls` returns original, thumbnail, preview, and video URLs.
- The live check proves thumbnail WebP/max-edge 320, preview WebP/max-edge 1280, and video Range 206.

- [ ] **Step 1: Write failing URL and dimension-policy tests for `style/thumbnail`**
- [ ] **Step 2: Verify the current checker lacks thumbnail validation**
- [ ] **Step 3: Provision `thumbnail` with `putBucketImageStyle` and the verified
  `image/resize,w_320,h_320,m_lfit/quality,q_75/format,webp` process**
- [ ] **Step 4: Add thumbnail and preview probes to `check-media-cdn.ts`**
- [ ] **Step 5: Invoke the media CDN check during production deployment after system media synchronization**
- [ ] **Step 6: Run `bun test tests/unit/media-cdn-config.test.ts`**

### Task 8: Regenerate Contracts and Complete the Audit

**Files:**
- Regenerate: `openapi/openapi.json`
- Regenerate: `web/api/generated/`
- Modify: tests affected by the new media fields and removed Base64/binary contracts

**Interfaces:**
- OpenAPI exposes `thumbnailUrl`, `url`, and `originalUrl` for browser media.
- Voice preview exposes a CDN URL and no Base64 field.

- [ ] **Step 1: Run `bun run api:spec && bun run api:generate`**
- [ ] **Step 2: Run all focused media, portrait, scene, voice, audit, and policy tests**
- [ ] **Step 3: Run `make ci`**
- [ ] **Step 4: Run `bun run typecheck`**
- [ ] **Step 5: Run `bun run build`**
- [ ] **Step 6: Run `git diff --check` and inspect every changed file**
- [ ] **Step 7: On production credentials, apply system-media synchronization and run the live CDN checker without running E2E**
