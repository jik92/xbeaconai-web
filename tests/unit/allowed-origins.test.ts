import { describe, expect, test } from "bun:test";
import { resolveAllowedOrigins } from "../../server/http/allowed-origins";

describe("allowed request origins", () => {
  test("trusts both loopback hostnames for the selected development Web port", () => {
    const origins = resolveAllowedOrigins({ isProduction: false, apiPort: 5175, devWebPort: "5174" });

    expect(origins.has("http://127.0.0.1:5174")).toBe(true);
    expect(origins.has("http://localhost:5174")).toBe(true);
    expect(origins.has("http://127.0.0.1:5175")).toBe(true);
  });

  test("does not trust a development Web port in production", () => {
    const origins = resolveAllowedOrigins({
      isProduction: true,
      apiPort: 8787,
      devWebPort: "5174",
      configured: "https://app.xbeaconai.com",
    });

    expect(origins.has("http://127.0.0.1:5174")).toBe(false);
    expect(origins.has("http://localhost:5174")).toBe(false);
    expect(origins.has("https://app.xbeaconai.com")).toBe(true);
  });

  test("ignores invalid development ports", () => {
    expect(
      resolveAllowedOrigins({ isProduction: false, apiPort: 8787, devWebPort: "invalid" }).has("http://localhost:0"),
    ).toBe(false);
  });
});
