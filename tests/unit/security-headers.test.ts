import { describe, expect, test } from "bun:test";
import { buildSecurityHeaders } from "../../server/http/security-headers";

describe("security headers", () => {
  test("allows only the configured public media origin and sends an origin Referer across subdomains", () => {
    const headers = buildSecurityHeaders("https://files.xbeaconai.com");
    const csp = headers["Content-Security-Policy"];

    expect(csp).toContain("img-src 'self' data: https://files.xbeaconai.com");
    expect(csp).toContain("media-src 'self' https://files.xbeaconai.com");
    expect(csp.split("; ").find((directive) => directive.startsWith("img-src "))).not.toBe(
      "img-src 'self' data: https:",
    );
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });

  test("does not widen local media sources when no public origin is configured", () => {
    const csp = buildSecurityHeaders()["Content-Security-Policy"];

    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("media-src 'self'");
    expect(csp).not.toContain("blob:");
    expect(csp).not.toContain("https://files.xbeaconai.com");
  });
});
