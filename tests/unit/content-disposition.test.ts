import { describe, expect, test } from "bun:test";
import { inlineUtf8ContentDisposition } from "../../server/uploads/content-disposition";

describe("UTF-8 content disposition", () => {
  test("encodes Chinese file names without an ASCII filename fallback", () => {
    const value = inlineUtf8ContentDisposition("截屏 01.png");
    expect(value).toBe("inline; filename*=UTF-8''%E6%88%AA%E5%B1%8F%20%30%31%2E%70%6E%67");
    expect(value).not.toContain('filename="');
  });

  test("removes control characters before encoding", () => {
    expect(inlineUtf8ContentDisposition("safe\r\nname.png")).toBe(
      "inline; filename*=UTF-8''%73%61%66%65%6E%61%6D%65%2E%70%6E%67",
    );
  });
});
