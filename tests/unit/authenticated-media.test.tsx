import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { AuthenticatedMedia } from "../../src/components/domain/authenticated-media";

const authenticatedBlobUrl = mock();

mock.module("@/api/api-client", () => ({
  authenticatedBlobUrl,
}));

describe("AuthenticatedMedia error and retry", () => {
  afterEach(() => {
    cleanup();
    authenticatedBlobUrl.mockReset();
  });

  test("transitions from loading to error when authenticatedBlobUrl rejects", async () => {
    authenticatedBlobUrl.mockRejectedValueOnce(new Error("Network error"));
    render(<AuthenticatedMedia url="/api/assets/1/content" mimeType="video/mp4" alt="test" />);
    expect(screen.getByText("正在载入结果预览…")).toBeDefined();
    const errorText = await screen.findByText("无法载入预览。");
    expect(errorText).toBeDefined();
    expect(screen.getByText("重试")).toBeDefined();
  });

  test("clicking retry calls authenticatedBlobUrl again and shows media on success", async () => {
    const user = userEvent.setup();
    authenticatedBlobUrl.mockRejectedValueOnce(new Error("Network error"));
    render(<AuthenticatedMedia url="/api/assets/1/content" mimeType="video/mp4" alt="test" />);
    await screen.findByText("无法载入预览。");

    authenticatedBlobUrl.mockResolvedValueOnce("blob:http://example.com/video");
    await user.click(screen.getByText("重试"));
    expect(authenticatedBlobUrl).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      const video = document.querySelector("video");
      if (!video?.src) throw new Error("video not ready");
    });
    const video = document.querySelector("video");
    if (!video) throw new Error("video element missing after waitFor");
    expect(video.src).toBe("blob:http://example.com/video");
  });

  test("shows media directly when authenticatedBlobUrl resolves on first attempt", async () => {
    authenticatedBlobUrl.mockResolvedValueOnce("blob:http://example.com/ok");
    render(<AuthenticatedMedia url="/api/assets/1/content" mimeType="image/png" alt="test" />);
    const img = await screen.findByAltText("test");
    expect(img).toBeDefined();
    expect(authenticatedBlobUrl).toHaveBeenCalledTimes(1);
  });
});
