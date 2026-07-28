import { describe, expect, test } from "bun:test";
import { publicMediaUrls } from "../../server/storage/public-media-url";

describe("public media URLs", () => {
  test("encodes each object-key segment and gives images distinct preview and original URLs", () => {
    expect(
      publicMediaUrls({
        baseUrl: "https://files.xbeaconai.com/",
        storageKey: "users/u 1/商品 主图.jpg",
        mimeType: "image/jpeg",
        fallbackUrl: "/api/assets/123/content",
      }),
    ).toEqual({
      url: "https://files.xbeaconai.com/users/u%201/%E5%95%86%E5%93%81%20%E4%B8%BB%E5%9B%BE.jpg?x-tos-process=style/preview",
      originalUrl: "https://files.xbeaconai.com/users/u%201/%E5%95%86%E5%93%81%20%E4%B8%BB%E5%9B%BE.jpg",
    });
  });

  test("keeps video and audio on their original URLs", () => {
    for (const mimeType of ["video/mp4", "audio/mpeg"]) {
      expect(
        publicMediaUrls({
          baseUrl: "https://files.xbeaconai.com",
          storageKey: "users/demo/media.mp4",
          mimeType,
          fallbackUrl: "/api/assets/123/content",
        }),
      ).toEqual({
        url: "https://files.xbeaconai.com/users/demo/media.mp4",
        originalUrl: "https://files.xbeaconai.com/users/demo/media.mp4",
      });
    }
  });

  test("keeps protected API URLs when the public media domain is not configured", () => {
    expect(
      publicMediaUrls({
        storageKey: "users/demo/image.png",
        mimeType: "image/png",
        fallbackUrl: "/api/assets/123/content",
      }),
    ).toEqual({
      url: "/api/assets/123/content",
      originalUrl: "/api/assets/123/content",
    });
  });
});
