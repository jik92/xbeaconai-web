import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MediaPreview } from "../../web/components/domain/media-preview";

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
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.replaceChildren();
});

function renderMedia(mimeType: string, alt = "测试媒体") {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(
      <MediaPreview
        url={`https://files.xbeaconai.com/users/demo/${encodeURIComponent(alt)}`}
        mimeType={mimeType}
        alt={alt}
      />,
    );
  });
  return container;
}

describe("MediaPreview", () => {
  test("dispatches each supported MIME family to its native media element", () => {
    expect(renderMedia("image/png").querySelector("img")?.getAttribute("alt")).toBe("测试媒体");
    expect(renderMedia("video/mp4").querySelector("video")).not.toBeNull();
    expect(renderMedia("audio/wav").querySelector("audio")).not.toBeNull();
  });

  test("opens a full-screen image preview and closes it with Escape", () => {
    const container = renderMedia("image/png", "商品主图");

    act(() => {
      container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.querySelector('[role="dialog"][aria-label="商品主图全屏预览"]')).not.toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  test("renders a public image preview directly and opens the original image without a Blob conversion", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      root.render(
        <MediaPreview
          url="https://files.xbeaconai.com/users/demo/main.jpg?x-tos-process=style/preview"
          originalUrl="https://files.xbeaconai.com/users/demo/main.jpg"
          mimeType="image/jpeg"
          alt="公共商品主图"
        />,
      );
    });

    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://files.xbeaconai.com/users/demo/main.jpg?x-tos-process=style/preview",
    );

    act(() => {
      container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.querySelector('[role="dialog"] img')?.getAttribute("src")).toBe(
      "https://files.xbeaconai.com/users/demo/main.jpg",
    );
  });

  test("renders a system portrait directly from the media CDN", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      root.render(
        <MediaPreview
          url="https://files.xbeaconai.com/system/portraits/18.png?x-tos-process=style/thumbnail"
          mimeType="image/jpeg"
          alt="通用人像"
          previewable={false}
        />,
      );
    });

    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://files.xbeaconai.com/system/portraits/18.png?x-tos-process=style/thumbnail",
    );
  });

  test("resolves a protected media identifier to CDN before rendering it", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const requests: string[] = [];
    const originalFetch = globalThis.fetch;
    window.localStorage.setItem("yaozuo:auth-token:v1", "media-preview-test-token");
    globalThis.fetch = (async (input) => {
      requests.push(String(input));
      return new Response(
        JSON.stringify({
          url: "https://files.xbeaconai.com/users/demo/main.jpg?x-tos-process=style/preview",
          originalUrl: "https://files.xbeaconai.com/users/demo/main.jpg",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;
    try {
      await act(async () => {
        root.render(
          <MediaPreview
            url="/api/assets/00000000-0000-4000-8000-000000000000/access"
            mimeType="image/jpeg"
            alt="受保护素材"
          />,
        );
      });

      expect(requests).toEqual(["http://127.0.0.1:8787/api/assets/00000000-0000-4000-8000-000000000000/access"]);
      expect(container.querySelector("img")?.getAttribute("src")).toBe(
        "https://files.xbeaconai.com/users/demo/main.jpg?x-tos-process=style/preview",
      );
    } finally {
      window.localStorage.clear();
      globalThis.fetch = originalFetch;
    }
  });

  test("auto-plays full-screen video and closes from the explicit close button", () => {
    const container = renderMedia("video/mp4", "成片");
    const preview = container.querySelector<HTMLElement>('[aria-label="成片视频预览"]');

    act(() => {
      preview?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.parentElement).toBe(document.body);
    expect(dialog?.querySelector("video")?.autoplay).toBe(true);

    act(() => {
      dialog
        ?.querySelector<HTMLButtonElement>('button[aria-label="关闭全屏预览"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  test("plays a video on hover and pauses without losing progress when the pointer leaves", () => {
    const container = renderMedia("video/mp4", "悬停成片");
    const preview = container.querySelector<HTMLElement>('[aria-label="悬停成片视频预览"]');

    act(() => {
      preview?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(preview?.dataset.playbackState).toBe("playing");

    act(() => {
      preview?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });
    expect(preview?.dataset.playbackState).toBe("paused");
  });

  test("preserves the complete original video frame and keeps hover playback audible", () => {
    const container = renderMedia("video/mp4", "完整原片");
    const video = container.querySelector("video");

    expect(video?.className).toContain("object-contain");
    expect(video?.style.objectFit).toBe("contain");
    expect(video?.muted).toBe(false);
  });

  test("shows current and total video seconds in the top-right corner", () => {
    const container = renderMedia("video/mp4", "计时成片");
    const video = container.querySelector("video");
    Object.defineProperties(video, {
      currentTime: { configurable: true, value: 8 },
      duration: { configurable: true, value: 23 },
    });

    act(() => {
      video?.dispatchEvent(new Event("durationchange", { bubbles: true }));
      video?.dispatchEvent(new Event("timeupdate", { bubbles: true }));
    });

    expect(container.querySelector('[aria-label="播放时间"]')?.textContent).toBe("08s / 23s");
  });

  test("opens the full-screen player by double-clicking the video preview", () => {
    const container = renderMedia("video/mp4", "双击成片");
    const preview = container.querySelector<HTMLElement>('[aria-label="双击成片视频预览"]');

    act(() => {
      preview?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    expect(document.querySelector('[role="dialog"][aria-label="双击成片全屏预览"]')).not.toBeNull();
  });

  test("plays audio on hover and pauses without losing progress when the pointer leaves", () => {
    const container = renderMedia("audio/wav", "悬停配音");
    const preview = container.querySelector<HTMLElement>('[aria-label="悬停配音音频预览"]');
    const audio = container.querySelector("audio");
    let playCalls = 0;
    let pauseCalls = 0;
    if (audio) {
      audio.play = () => {
        playCalls += 1;
        return Promise.resolve();
      };
      audio.pause = () => {
        pauseCalls += 1;
      };
    }

    act(() => {
      preview?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(preview?.dataset.playbackState).toBe("playing");
    expect(playCalls).toBe(1);

    act(() => {
      preview?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });
    expect(preview?.dataset.playbackState).toBe("paused");
    expect(pauseCalls).toBe(1);
  });

  test("shows current and total audio seconds on the card", () => {
    const container = renderMedia("audio/wav", "计时配音");
    const audio = container.querySelector("audio");
    Object.defineProperties(audio, {
      currentTime: { configurable: true, value: 5 },
      duration: { configurable: true, value: 18 },
    });

    act(() => {
      audio?.dispatchEvent(new Event("durationchange", { bubbles: true }));
      audio?.dispatchEvent(new Event("timeupdate", { bubbles: true }));
    });

    expect(container.querySelector('[aria-label="播放时间"]')?.textContent).toBe("05s / 18s");
  });

  test("double-clicks into an auto-playing full-screen audio player and closes from the backdrop", () => {
    const container = renderMedia("audio/wav", "配音");
    const preview = container.querySelector<HTMLElement>('[aria-label="配音音频预览"]');

    act(() => {
      preview?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.querySelector("audio")?.autoplay).toBe(true);

    act(() => {
      dialog?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
