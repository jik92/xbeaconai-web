import { describe, expect, test } from "bun:test";
import { canonicalCorsRule, corsRulesMatch, parseCorsOrigins } from "../../scripts/configure-tos-browser-access";

describe("production TOS browser access", () => {
  test("normalizes exact browser origins without broad wildcards", () => {
    expect(parseCorsOrigins("https://app.xbeaconai.com,http://118.196.101.57:9000,https://app.xbeaconai.com")).toEqual([
      "http://118.196.101.57:9000",
      "https://app.xbeaconai.com",
    ]);
    expect(() => parseCorsOrigins("https://*.xbeaconai.com")).toThrow("无效的 TOS CORS Origin");
  });

  test("requires one canonical GET HEAD PUT rule with range headers", () => {
    const origins = ["https://app.xbeaconai.com"];
    const rule = canonicalCorsRule(origins);
    expect(rule.AllowedMethods.map(String)).toEqual(["GET", "HEAD", "PUT"]);
    expect(rule.ExposeHeaders).toContain("Content-Range");
    expect(corsRulesMatch([rule], origins)).toBe(true);
    expect(corsRulesMatch([{ ...rule, AllowedOrigins: ["*"] }], origins)).toBe(false);
  });
});
