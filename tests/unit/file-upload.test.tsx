import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FileUpload, fileMatchesAccept } from "../../web/components/domain/file-upload";

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
});
