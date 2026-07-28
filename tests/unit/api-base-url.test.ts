import { describe, expect, test } from "bun:test";
import { resolveApiBaseUrl } from "../../web/api/base-url";

describe("API base URL", () => {
  test("keeps localhost and direct IP deployments on their own origin", () => {
    expect(
      resolveApiBaseUrl("https://api.xbeaconai.com", { hostname: "localhost", origin: "http://localhost:8787" }),
    ).toBe("http://localhost:8787");
    expect(resolveApiBaseUrl(undefined, { hostname: "118.196.101.57", origin: "https://118.196.101.57" })).toBe(
      "https://118.196.101.57",
    );
  });

  test("uses and normalizes an explicit build-time API origin", () => {
    expect(
      resolveApiBaseUrl(" https://staging-api.xbeaconai.com/ ", {
        hostname: "staging.xbeaconai.com",
        origin: "https://staging.xbeaconai.com",
      }),
    ).toBe("https://staging-api.xbeaconai.com");
  });

  test("falls back from the production app domain to the production API domain", () => {
    expect(resolveApiBaseUrl(undefined, { hostname: "app.xbeaconai.com", origin: "https://app.xbeaconai.com" })).toBe(
      "https://api.xbeaconai.com",
    );
  });

  test("keeps unknown browser hosts same-origin when no API origin is configured", () => {
    expect(
      resolveApiBaseUrl(undefined, { hostname: "preview.example.com", origin: "https://preview.example.com" }),
    ).toBe("https://preview.example.com");
  });

  test("uses the loopback API during server-side execution", () => {
    expect(resolveApiBaseUrl(undefined)).toBe("http://127.0.0.1:8787");
  });
});
