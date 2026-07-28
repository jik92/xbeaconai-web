import { describe, expect, test } from "bun:test";
import { systemPortraitMedia, systemSceneMedia } from "../../shared/media/system-media";

describe("system media URLs", () => {
  test("builds stable CDN variants for a portrait", () => {
    expect(systemPortraitMedia(3)).toEqual({
      storageKey: "system/portraits/3.png",
      thumbnailUrl: "https://files.xbeaconai.com/system/portraits/3.png?x-tos-process=style/thumbnail",
      url: "https://files.xbeaconai.com/system/portraits/3.png?x-tos-process=style/preview",
      originalUrl: "https://files.xbeaconai.com/system/portraits/3.png",
    });
  });

  test("builds stable CDN variants for a scene", () => {
    expect(systemSceneMedia(9)).toEqual({
      storageKey: "system/scenes/9.jpg",
      thumbnailUrl: "https://files.xbeaconai.com/system/scenes/9.jpg?x-tos-process=style/thumbnail",
      url: "https://files.xbeaconai.com/system/scenes/9.jpg?x-tos-process=style/preview",
      originalUrl: "https://files.xbeaconai.com/system/scenes/9.jpg",
    });
  });
});
