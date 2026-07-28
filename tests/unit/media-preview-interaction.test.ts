import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("enables sound for hover video previews", () => {
  const source = readFileSync(resolve(import.meta.dir, "../../web/components/domain/media-preview.tsx"), "utf8");

  expect(source).toContain("autoPlay={hoverPlaying}");
  expect(source).toContain("muted={false}");
});
