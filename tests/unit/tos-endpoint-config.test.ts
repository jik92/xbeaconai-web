import { describe, expect, test } from "bun:test";
import { resolveTosConfig } from "../../server/env";

describe("TOS endpoint configuration", () => {
  test("uses the Shanghai public endpoint for local Server/Worker and signed URLs", () => {
    expect(resolveTosConfig({ isProduction: false })).toEqual({
      region: "cn-shanghai",
      bucket: "xbeacon-shanghai",
      serverEndpoint: "tos-cn-shanghai.volces.com",
      publicEndpoint: "tos-cn-shanghai.volces.com",
      corsOrigins: ["http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:4173", "http://localhost:4173"],
    });
  });

  test("requires explicit Shanghai intranet and public routes in production", () => {
    expect(
      resolveTosConfig({
        isProduction: true,
        region: "cn-shanghai",
        bucket: "xbeacon-shanghai",
        serverEndpoint: "tos-cn-shanghai.ivolces.com",
        publicEndpoint: "tos-cn-shanghai.volces.com",
        corsOrigins: "http://118.196.101.57:9000",
      }),
    ).toEqual({
      region: "cn-shanghai",
      bucket: "xbeacon-shanghai",
      serverEndpoint: "tos-cn-shanghai.ivolces.com",
      publicEndpoint: "tos-cn-shanghai.volces.com",
      corsOrigins: ["http://118.196.101.57:9000"],
    });
  });

  test("rejects missing or public Server Endpoint production configuration", () => {
    expect(() => resolveTosConfig({ isProduction: true })).toThrow("生产启动必须配置 TOS_REGION");
    expect(() =>
      resolveTosConfig({
        isProduction: true,
        region: "cn-shanghai",
        bucket: "xbeacon-shanghai",
        serverEndpoint: "tos-cn-shanghai.volces.com",
        publicEndpoint: "tos-cn-shanghai.volces.com",
        corsOrigins: "http://118.196.101.57:9000",
      }),
    ).toThrow("生产 TOS_SERVER_ENDPOINT 必须是 tos-cn-shanghai.ivolces.com");
  });

  test("rejects an intranet Server Endpoint in local development", () => {
    expect(() =>
      resolveTosConfig({
        isProduction: false,
        region: "cn-shanghai",
        bucket: "xbeacon-shanghai",
        serverEndpoint: "tos-cn-shanghai.ivolces.com",
        publicEndpoint: "tos-cn-shanghai.volces.com",
      }),
    ).toThrow("本地 TOS_SERVER_ENDPOINT 必须是 tos-cn-shanghai.volces.com");
  });
});
