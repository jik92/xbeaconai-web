import { describe, expect, test } from "bun:test";
import type { LibraryAsset } from "../../web/entities/types";
import { resolveOptionalRemixVoice } from "../../web/features/video-remix/optional-voice";

function voice(id: string): LibraryAsset {
  return {
    id,
    name: id,
    originalName: `${id}.mp3`,
    mimeType: "audio/mpeg",
    size: 1,
    kind: "voice",
    thumbnailUrl: `https://files.xbeaconai.com/users/demo/${id}.mp3`,
    url: `/api/assets/${id}/access`,
    originalUrl: `/api/assets/${id}/access`,
    createdAt: new Date(0).toISOString(),
  };
}

describe("video remix optional voice", () => {
  test("keeps an available selected voice", () => {
    const selected = voice("available");
    expect(resolveOptionalRemixVoice(selected, [selected])).toBe(selected);
  });

  test("drops a selected voice that has been deleted", () => {
    expect(resolveOptionalRemixVoice(voice("deleted"), [voice("available")])).toBeNull();
  });

  test("keeps an unselected voice optional", () => {
    expect(resolveOptionalRemixVoice(null, [])).toBeNull();
  });
});
