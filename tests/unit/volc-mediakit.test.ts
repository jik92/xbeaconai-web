import { describe, expect, test } from "bun:test";
import { MediaKitError, VolcMediaKitProvider } from "../../server/providers/volc-mediakit";

const config = {
  apiKey: "test-key",
  baseUrl: "https://mediakit.example.com/",
  pollIntervalMs: 1_000,
  pollTimeoutMs: 30_000,
};

describe("VolcMediaKitProvider", () => {
  test("submits the selected tool with bearer authentication", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const provider = new VolcMediaKitProvider(config, async (url, init) => {
      requestUrl = url;
      requestInit = init;
      return Response.json({ success: true, task_id: "task-1", request_id: "request-1" });
    });

    await expect(provider.submit("enhance-video-fast", "https://files.example.com/source.mp4")).resolves.toEqual({
      taskId: "task-1",
      requestId: "request-1",
    });
    expect(requestUrl).toBe("https://mediakit.example.com/api/v1/tools/enhance-video-fast");
    expect(requestInit?.method).toBe("POST");
    expect(requestInit?.headers).toMatchObject({ Authorization: "Bearer test-key" });
    expect(JSON.parse(String(requestInit?.body))).toEqual({ video_url: "https://files.example.com/source.mp4" });
  });

  test("retrieves a completed task", async () => {
    const provider = new VolcMediaKitProvider(config, async (url) => {
      expect(url).toBe("https://mediakit.example.com/api/v1/tasks/task%2F1");
      return Response.json({ success: true, status: "completed", result: { video_url: "https://result/video.mp4" } });
    });

    await expect(provider.retrieve("task/1")).resolves.toMatchObject({ status: "completed" });
  });

  test("marks permission failures as non-retryable and redacts URLs", async () => {
    const provider = new VolcMediaKitProvider(config, async () =>
      Response.json(
        { success: false, error: { code: "AccessDenied", message: "denied https://private.example.com/file" } },
        { status: 403 },
      ),
    );

    try {
      await provider.submit("erase-video-subtitle-pro", "https://files.example.com/source.mp4");
      throw new Error("expected provider failure");
    } catch (error) {
      expect(error).toBeInstanceOf(MediaKitError);
      expect(error).toMatchObject({ code: "MEDIAKIT_AccessDenied", retryable: false, status: 403 });
      expect((error as Error).message).toBe("denied [redacted-url]");
    }
  });
});
