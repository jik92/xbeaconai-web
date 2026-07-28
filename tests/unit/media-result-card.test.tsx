import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MediaResultCard } from "../../web/components/domain/media-result-card";

const window = new Window();
const roots: Root[] = [];

beforeAll(() => {
  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    Element: window.Element,
    Event: window.Event,
    HTMLElement: window.HTMLElement,
    HTMLMediaElement: window.HTMLMediaElement,
    MouseEvent: window.MouseEvent,
    KeyboardEvent: window.KeyboardEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

function renderResult(mimeType: string, name: string, onDownload = mock(() => undefined)) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(
      <MediaResultCard
        url="https://files.xbeaconai.com/users/test/generated/result"
        mimeType={mimeType}
        name={name}
        authenticated={false}
        onDownload={onDownload}
      />,
    );
  });
  return { container, onDownload };
}

describe("MediaResultCard", () => {
  test("uses the same result shell and complete-source frame for images and videos", () => {
    const image = renderResult("image/png", "生成图片").container;
    const video = renderResult("video/mp4", "生成视频").container;

    const imageCard = image.querySelector("article");
    const videoCard = video.querySelector("article");
    expect(imageCard?.className).toBe(videoCard?.className);
    expect(imageCard?.dataset.mediaResultKind).toBe("image");
    expect(videoCard?.dataset.mediaResultKind).toBe("video");
    expect(image.querySelector("img")?.className).toContain("object-contain");
    expect(video.querySelector("video")?.className).toContain("object-contain");
    const videoHoverTarget = video.querySelector('[aria-label="生成视频视频预览"]');
    expect(videoHoverTarget?.className).toContain("absolute inset-0");
    expect(videoHoverTarget?.className).toContain("h-full w-full");
    expect(video.querySelector(".group\\/video-preview")?.className).toContain("size-full");
  });

  test("removes the metadata footer and overlays download on the media", () => {
    const { container, onDownload } = renderResult("image/png", "生成图片");
    expect(container.querySelector("footer")).toBeNull();

    act(() => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="下载生成图片"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(container.querySelector('button[aria-label="下载生成图片"]')?.className).toContain(
      "absolute bottom-2 right-2",
    );
  });

  test("updates the complete frame to the media intrinsic aspect ratio", () => {
    const container = renderResult("image/png", "横版图片").container;
    const image = container.querySelector("img");
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 1600 },
      naturalHeight: { configurable: true, value: 900 },
    });

    act(() => image?.dispatchEvent(new Event("load", { bubbles: true })));

    expect(
      container.querySelector<HTMLElement>("article > div")?.style.aspectRatio.startsWith(String(1600 / 900)),
    ).toBe(true);
  });
});
