import { describe, expect, test } from "bun:test";
import pkg from "../../package.json";

describe("application scaffold", () => {
  test("exposes required scripts", () => {
    expect(pkg.scripts).toMatchObject({
      dev: expect.any(String),
      build: expect.any(String),
      typecheck: expect.any(String),
    });
  });
});
