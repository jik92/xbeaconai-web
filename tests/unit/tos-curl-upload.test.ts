import { describe, expect, test } from "bun:test";
import { parseCurlProgress, parseCurlUploadResponse } from "../../server/storage/ossutils";

describe("TOS curl upload parsing", () => {
  test("reads the final progress value from curl's progress bar", () => {
    expect(parseCurlProgress("#### 9.4%\r######## 49.2%\r########## 100.0%\n")).toBe(100);
    expect(parseCurlProgress("no progress yet")).toBeUndefined();
  });

  test("reads a successful HTTP status and ETag", () => {
    const response = parseCurlUploadResponse(
      'HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 OK\r\nETag: "abc123"\r\n\r\nCURL_STATUS:200',
    );
    expect(response).toEqual({ status: 200, eTag: '"abc123"' });
  });
});
