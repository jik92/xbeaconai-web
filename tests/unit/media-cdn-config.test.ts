import { describe, expect, test } from "bun:test";
import { buildMediaCdnCheckUrls } from "../../scripts/check-media-cdn";
import {
  MEDIA_CDN_DEFAULT_ALLOWED_REFERERS,
  MEDIA_IMAGE_STYLES,
  mediaCdnDesiredConfig,
  tosJsonPayloadHeaders,
  upsertVoicePreviewLifecycleRule,
  VOICE_PREVIEW_LIFECYCLE_RULE_ID,
} from "../../scripts/setup-media-cdn";

describe("media CDN configuration", () => {
  test("allows the production application and the approved local development IP Referer", () => {
    expect(MEDIA_CDN_DEFAULT_ALLOWED_REFERERS).toEqual(["app.xbeaconai.com", "127.0.0.1"]);
  });

  test("keeps the TOS bucket private and preserves image-processing queries in the cache key", () => {
    const config = mediaCdnDesiredConfig({
      domain: "files.xbeaconai.com",
      bucket: "xbeacon-shanghai",
      region: "cn-shanghai",
      allowedReferers: ["app.xbeaconai.com"],
    });
    const origin = config.Origin[0]?.OriginAction.OriginLines[0];
    const queryComponent = config.CacheKey[0]?.CacheKeyAction.CacheKeyComponents[0];

    expect(origin).toMatchObject({
      Address: "xbeacon-shanghai.tos-cn-shanghai.volces.com",
      BucketName: "xbeacon-shanghai",
      InstanceType: "tos",
      PrivateBucketAccess: true,
      Region: "cn-shanghai",
    });
    expect(queryComponent).toMatchObject({
      Action: "include",
      Object: "queryString",
      Subobject: "*",
    });
  });

  test("uses a non-empty Referer whitelist, long successful cache, and the default no-error-cache behavior", () => {
    const config = mediaCdnDesiredConfig({
      domain: "files.xbeaconai.com",
      bucket: "xbeacon-shanghai",
      region: "cn-shanghai",
      allowedReferers: ["app.xbeaconai.com"],
    });

    expect(config.RefererAccessRule).toEqual({
      Switch: true,
      RuleType: "allow",
      Referers: ["app.xbeaconai.com"],
      AllowEmpty: false,
      IgnoreCase: true,
    });
    expect(config.Cache[0]?.CacheAction).toMatchObject({ Action: "cache", Ttl: 31_536_000 });
    expect("NegativeCache" in config).toBe(false);
  });

  test("defines bounded WebP thumbnail and preview styles", () => {
    expect(MEDIA_IMAGE_STYLES).toEqual({
      thumbnail: "image/resize,w_320,h_320,m_lfit/quality,q_75/format,webp",
      preview: "image/resize,w_1280,h_1280,m_lfit/format,webp",
    });
  });

  test("signs TOS bucket JSON mutations with the serialized payload hash", () => {
    expect(tosJsonPayloadHeaders({ Content: "image/resize,w_320/format,webp" })).toEqual({
      "x-tos-content-sha256": "db7af8195c1531613761daf4da2b9d2cab7c4f161c38b995eb1fc2ec8ce0cf73",
    });
  });

  test("preserves unrelated lifecycle rules while enforcing voice preview expiry", () => {
    const unrelated = {
      ID: "archive-old-results",
      Prefix: "results/",
      Status: "Enabled" as const,
      Transitions: [{ StorageClass: "IA", Days: 30 }],
    };
    const stale = {
      ID: VOICE_PREVIEW_LIFECYCLE_RULE_ID,
      Prefix: "wrong/",
      Status: "Disabled" as const,
      Expiration: { Days: 99 },
    };

    expect(upsertVoicePreviewLifecycleRule([unrelated, stale])).toEqual([
      unrelated,
      {
        ID: VOICE_PREVIEW_LIFECYCLE_RULE_ID,
        Prefix: "ephemeral/voice-previews/",
        Status: "Enabled",
        Expiration: { Days: 1 },
      },
    ]);
  });

  test("builds encoded original, thumbnail, preview, and range-check URLs", () => {
    expect(
      buildMediaCdnCheckUrls({
        domain: "files.xbeaconai.com",
        imageKey: "users/demo/商品 主图.jpg",
        videoKey: "users/demo/source video.mp4",
      }),
    ).toEqual({
      imageOriginal: "https://files.xbeaconai.com/users/demo/%E5%95%86%E5%93%81%20%E4%B8%BB%E5%9B%BE.jpg",
      imageThumbnail:
        "https://files.xbeaconai.com/users/demo/%E5%95%86%E5%93%81%20%E4%B8%BB%E5%9B%BE.jpg?x-tos-process=style/thumbnail",
      imagePreview:
        "https://files.xbeaconai.com/users/demo/%E5%95%86%E5%93%81%20%E4%B8%BB%E5%9B%BE.jpg?x-tos-process=style/preview",
      videoOriginal: "https://files.xbeaconai.com/users/demo/source%20video.mp4",
    });
  });
});
