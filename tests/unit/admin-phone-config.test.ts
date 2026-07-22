import { describe, expect, test } from "bun:test";
import { parseAdminPhones } from "../../server/env";

describe("administrator phone configuration", () => {
  test("supports one or multiple comma-separated phone numbers", () => {
    expect([...parseAdminPhones("13800000001")]).toEqual(["13800000001"]);
    expect([...parseAdminPhones(" 13800000001,13900000002,,13800000001 ")]).toEqual(["13800000001", "13900000002"]);
  });
});
