import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

describe("portrait card style isolation", () => {
  test("keeps portrait library cards at the library grid width when remix styles are loaded", async () => {
    const window = new Window();
    const style = window.document.createElement("style");
    style.textContent = [
      await Bun.file(new URL("../../web/styles/globals.css", import.meta.url)).text(),
      await Bun.file(new URL("../../web/features/video-remix/remix-project.css", import.meta.url)).text(),
    ].join("\n");
    window.document.head.append(style);

    const card = window.document.createElement("article");
    card.className = "portrait-card";
    window.document.body.append(card);

    expect(window.getComputedStyle(card).width).not.toBe("68px");
  });
});
