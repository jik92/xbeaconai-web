import { describe, expect, test } from "bun:test";
import { randomUuid } from "@/lib/random-id";

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("randomUuid", () => {
  test("uses the native implementation when available", () => {
    const native = "123e4567-e89b-42d3-a456-426614174000";
    expect(randomUuid({ randomUUID: () => native })).toBe(native);
  });

  test("creates a UUID v4 without crypto.randomUUID", () => {
    const value = randomUuid({
      getRandomValues: (bytes) => {
        bytes.fill(17);
        return bytes;
      },
    });
    expect(value).toMatch(uuidV4);
  });

  test("creates a UUID v4 when Web Crypto is unavailable", () => {
    expect(randomUuid(null)).toMatch(uuidV4);
  });
});
