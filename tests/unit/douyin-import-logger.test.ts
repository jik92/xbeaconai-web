import { describe, expect, test } from "bun:test";
import type { ImportLogEvent, ImportStage } from "../../server/imports/import-logger";
import { emitLog, logFailure, sanitizeError, stageComplete, stageStart } from "../../server/imports/import-logger";

describe("import-logger", () => {
  test("stageStart returns a timestamp", () => {
    const ts = stageStart();
    expect(typeof ts).toBe("number");
    expect(ts).toBeGreaterThan(0);
  });

  test("stageComplete emits valid log event via emitLog", () => {
    // Capture console output
    const lines: string[] = [];
    const orig = console.log;
    console.log = (s: string) => lines.push(s);

    try {
      stageComplete("job-123", "download_complete", Date.now() - 500, 1024000);

      expect(lines.length).toBe(1);
      const parsed = JSON.parse(lines[0].replace("[douyin-import] ", "")) as ImportLogEvent;

      expect(parsed.jobId).toBe("job-123");
      expect(parsed.stage).toBe("download_complete");
      expect(parsed.result).toBe("ok");
      expect(parsed.durationMs).toBeGreaterThanOrEqual(0);
      expect(parsed.fileSizeBytes).toBe(1024000);
      // Must NOT contain any sensitive fields
      expect(JSON.stringify(parsed)).not.toContain("url");
      expect(JSON.stringify(parsed)).not.toContain("cookie");
      expect(JSON.stringify(parsed)).not.toContain("token");
      expect(JSON.stringify(parsed)).not.toContain("header");
    } finally {
      console.log = orig;
    }
  });

  test("logFailure includes sanitized error without URLs", () => {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (s: string) => lines.push(s);

    try {
      logFailure("job-456", "failure", Date.now() - 1000, "DOWNLOAD_FAILED", "Connection refused");

      expect(lines.length).toBe(1);
      const parsed = JSON.parse(lines[0].replace("[douyin-import] ", "")) as ImportLogEvent;

      expect(parsed.jobId).toBe("job-456");
      expect(parsed.stage).toBe("failure");
      expect(parsed.result).toBe("error");
      expect(parsed.errorCode).toBe("DOWNLOAD_FAILED");
      expect(parsed.errorSummary).toBe("Connection refused");
      // Must NOT leak any URL-like content
      expect(JSON.stringify(parsed)).not.toContain("http");
    } finally {
      console.log = orig;
    }
  });

  test("sanitizeError redacts URLs from error messages", () => {
    const err = new Error("Failed to fetch https://v26-web.douyinvod.com/secret/video.mp4");
    const result = sanitizeError(err);

    expect(result.summary).not.toContain("v26-web.douyinvod.com");
    expect(result.summary).not.toContain("secret");
    expect(result.summary).toContain("[REDACTED_URL]");
    expect(result.code).toBe("Error");
  });

  test("sanitizeError redacts long token-like strings", () => {
    const err = new Error(
      "Auth failed with token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdefghijklmnopqrstuvwxyz1234567890",
    );
    const result = sanitizeError(err);

    expect(result.summary).not.toContain("eyJhbGci");
    expect(result.summary).toContain("[REDACTED_TOKEN]");
  });

  test("sanitizeError handles non-Error string values", () => {
    const result = sanitizeError("plain string error");
    expect(result.code).toBe("ERROR");
    expect(result.summary).toBe("plain string error");
  });

  test("emitLog never includes sensitive field names", () => {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (s: string) => lines.push(s);

    try {
      emitLog({
        jobId: "test-1",
        stage: "success",
        result: "ok",
        durationMs: 1234,
        fileSizeBytes: 999,
      });

      const raw = lines[0];
      // Verify no sensitive field names appear
      expect(raw).not.toContain('"url"');
      expect(raw).not.toContain('"shareUrl"');
      expect(raw).not.toContain('"cookie"');
      expect(raw).not.toContain('"token"');
      expect(raw).not.toContain('"header"');
      expect(raw).not.toContain('"referer"');
      expect(raw).not.toContain('"userAgent"');
      // Must contain expected fields
      expect(raw).toContain('"jobId"');
      expect(raw).toContain('"stage"');
      expect(raw).toContain('"result"');
      expect(raw).toContain('"durationMs"');
      expect(raw).toContain('"fileSizeBytes"');
    } finally {
      console.log = orig;
    }
  });

  test("all defined stages are valid ImportStage values", () => {
    const stages: ImportStage[] = [
      "download_start",
      "download_complete",
      "download_failure",
      "probe_start",
      "probe_complete",
      "probe_failure",
      "save_local_start",
      "save_local_complete",
      "save_local_failure",
      "tos_upload_start",
      "tos_upload_complete",
      "tos_upload_failure",
      "tos_skip",
      "asset_created",
      "asset_create_failure",
      "success",
      "failure",
      "cancel",
      "cleanup",
    ];
    for (const stage of stages) {
      const event: ImportLogEvent = {
        jobId: "test",
        stage,
        result: "ok",
        durationMs: 100,
      };
      expect(event.stage).toBe(stage);
    }
  });
});
