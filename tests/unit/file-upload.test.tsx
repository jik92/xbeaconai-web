import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { FileUpload, fileMatchesAccept } from "../../web/components/domain/file-upload";

const window = new Window();
const roots: Root[] = [];

beforeAll(() => {
  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.replaceChildren();
});

describe("FileUpload", () => {
  test("renders a compact labelled file input with reusable constraints", () => {
    const html = renderToStaticMarkup(
      <FileUpload
        id="media-file"
        label="素材文件"
        description="支持图片、视频和音频"
        accept="image/*,video/*,audio/*"
        multiple
        onFilesChange={() => undefined}
      />,
    );

    expect(html).toContain('for="media-file"');
    expect(html).toContain('type="file"');
    expect(html).toContain('accept="image/*,video/*,audio/*"');
    expect(html).toContain("multiple");
    expect(html).toContain('aria-describedby="media-file-description"');
    expect(html).toContain("支持图片、视频和音频");
  });

  test("disables selection and exposes upload progress", () => {
    const html = renderToStaticMarkup(
      <FileUpload
        uploading
        progress={64}
        files={[new File(["voice"], "voice.wav", { type: "audio/wav" })]}
        aria-label="上传音色"
        onFilesChange={() => undefined}
      />,
    );

    expect(html).toContain("disabled");
    expect(html).toContain('role="status"');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="64"');
    expect(html).toContain("正在上传");
  });

  test("matches MIME families, exact MIME types, and file extensions", () => {
    expect(fileMatchesAccept({ name: "cover.png", type: "image/png" }, "image/*")).toBe(true);
    expect(fileMatchesAccept({ name: "voice.wav", type: "audio/wav" }, "audio/wav")).toBe(true);
    expect(fileMatchesAccept({ name: "clip.MOV", type: "" }, ".mov")).toBe(true);
    expect(fileMatchesAccept({ name: "notes.txt", type: "text/plain" }, "image/*,.pdf")).toBe(false);
  });

  test("shows a local thumbnail for a pending image without using a Blob URL", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    const originalFileReader = globalThis.FileReader;
    let createCalls = 0;
    URL.createObjectURL = () => {
      createCalls += 1;
      return "blob:forbidden-local-preview";
    };
    URL.revokeObjectURL = () => undefined;
    class PreviewFileReader {
      result: string | null = null;
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null;

      readAsDataURL() {
        this.result = "data:image/png;base64,cHJldmlldw==";
        queueMicrotask(() => this.onload?.({} as ProgressEvent<FileReader>));
      }
    }
    globalThis.FileReader = PreviewFileReader as unknown as typeof FileReader;

    try {
      await act(async () => {
        root.render(
          <FileUpload
            files={[new File(["image"], "cover.png", { type: "image/png" })]}
            onFilesChange={() => undefined}
          />,
        );
        await Promise.resolve();
      });

      expect(createCalls).toBe(0);
      expect(container.textContent).toContain("cover.png");
      expect(container.textContent).toContain("等待上传");
      expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,cHJldmlldw==");
    } finally {
      URL.createObjectURL = originalCreateObjectUrl;
      URL.revokeObjectURL = originalRevokeObjectUrl;
      globalThis.FileReader = originalFileReader;
    }
  });
});
