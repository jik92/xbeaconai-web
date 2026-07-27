import { describe, expect, test } from "bun:test";
import { buildVolcOpenApiSignedRequest, callVolcOpenApi, VolcOpenApiError } from "../../server/providers/volc-openapi";

const config = {
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
  endpoint: "https://cdn.volcengineapi.com",
  region: "cn-north-1",
  service: "CDN",
  version: "2021-03-01",
};

describe("Volcengine OpenAPI", () => {
  test("signs a JSON request without exposing the secret", () => {
    const request = buildVolcOpenApiSignedRequest(
      config,
      "ListCdnDomains",
      { Domain: "app.example.com", ExactMatch: true },
      new Date("2026-07-28T02:00:00.000Z"),
    );
    const headers = new Headers(request.init.headers);

    expect(String(request.url)).toBe("https://cdn.volcengineapi.com/?Action=ListCdnDomains&Version=2021-03-01");
    expect(headers.get("authorization")).toContain("Credential=test-access-key/20260728/cn-north-1/CDN/request");
    expect(headers.get("authorization")).not.toContain(config.secretAccessKey);
    expect(headers.get("x-date")).toBe("20260728T020000Z");
  });

  test("surfaces an OpenAPI business error even when HTTP is 200", async () => {
    await expect(
      callVolcOpenApi(config, "ListCdnDomains", {}, async () =>
        Response.json({
          ResponseMetadata: {
            RequestId: "request-1",
            Error: { Code: "AccessDenied", Message: "permission denied" },
          },
        }),
      ),
    ).rejects.toEqual(new VolcOpenApiError("AccessDenied", "permission denied", "request-1"));
  });
});
