import { describe, expect, test } from "bun:test";
import { resolveTosConfig } from "../../server/env";

describe("TOS endpoint configuration", () => {
  test("keeps the existing application defaults when no environment overrides are present", () => {
    expect(resolveTosConfig({})).toEqual({
      region: "cn-beijing",
      bucket: "xbeacon",
      internalEndpoint: "tos-cn-beijing.volces.com",
      publicEndpoint: "tos-cn-beijing.volces.com",
    });
  });

  test("supports separate intranet data access and public signed URLs", () => {
    expect(
      resolveTosConfig({
        region: "cn-shanghai",
        bucket: "xbeacon-shanghai",
        internalEndpoint: "tos-cn-shanghai.ivolces.com",
        publicEndpoint: "tos-cn-shanghai.volces.com",
      }),
    ).toEqual({
      region: "cn-shanghai",
      bucket: "xbeacon-shanghai",
      internalEndpoint: "tos-cn-shanghai.ivolces.com",
      publicEndpoint: "tos-cn-shanghai.volces.com",
    });
  });

  test("keeps TOS_ENDPOINT as a backward-compatible override for both routes", () => {
    expect(resolveTosConfig({ endpoint: "tos.example.test" })).toMatchObject({
      internalEndpoint: "tos.example.test",
      publicEndpoint: "tos.example.test",
    });
  });
});
