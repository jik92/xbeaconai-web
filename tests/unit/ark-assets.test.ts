import { describe, expect, test } from "bun:test";
import { ArkAssetsClient, buildArkAssetsSignedRequest } from "../../server/providers/ark-assets";

const config = {
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
  endpoint: "https://ark.cn-beijing.volcengineapi.com",
};

describe("Ark Assets OpenAPI", () => {
  test("signs the documented Ark action and request body without exposing the secret", () => {
    const request = buildArkAssetsSignedRequest(
      config,
      "CreateAsset",
      {
        GroupId: "group-1",
        URL: "https://example.test/portrait.jpg",
        Name: "portrait",
        AssetType: "Image",
        ProjectName: "default",
      },
      new Date("2026-07-26T03:00:00.000Z"),
    );
    const headers = new Headers(request.init.headers);

    expect(String(request.url)).toBe("https://ark.cn-beijing.volcengineapi.com/?Action=CreateAsset&Version=2024-01-01");
    expect(headers.get("authorization")).toContain("Credential=test-access-key/20260726/cn-beijing/ark/request");
    expect(headers.get("authorization")).toContain("SignedHeaders=content-type;host;x-content-sha256;x-date");
    expect(headers.get("x-date")).toBe("20260726T030000Z");
    expect(headers.get("authorization")).not.toContain(config.secretAccessKey);
    expect(JSON.parse(String(request.init.body))).toEqual({
      GroupId: "group-1",
      URL: "https://example.test/portrait.jpg",
      Name: "portrait",
      AssetType: "Image",
      ProjectName: "default",
    });
  });

  test("does not retry a mutating CreateAsset request", async () => {
    let calls = 0;
    const client = new ArkAssetsClient(config, async () => {
      calls += 1;
      return Response.json(
        { ResponseMetadata: { Error: { Code: "InternalError", Message: "temporary" } } },
        { status: 503 },
      );
    });

    await expect(
      client.createAsset({
        groupId: "group-1",
        url: "https://example.test/portrait.jpg",
        name: "portrait",
        assetType: "Image",
      }),
    ).rejects.toThrow("temporary");
    expect(calls).toBe(1);
  });

  test("maps the documented asset creation and status payloads", async () => {
    const requests: Array<{ action: string; body: Record<string, unknown> }> = [];
    const client = new ArkAssetsClient(config, async (url, init) => {
      const action = new URL(String(url)).searchParams.get("Action") ?? "";
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({ action, body });
      if (action === "CreateAssetGroup") return Response.json({ Result: { Id: "group-1" } });
      if (action === "CreateAsset") return Response.json({ Result: { Id: "asset-1" } });
      return Response.json({ Result: { Id: "asset-1", Status: "Active", GroupId: "group-1" } });
    });

    const group = await client.createAssetGroup({ name: "portrait group" });
    const asset = await client.createAsset({
      groupId: group.Id,
      url: "https://example.test/portrait.jpg",
      name: "portrait",
      assetType: "Image",
    });
    const active = await client.getAsset(asset.Id);

    expect(active.Status).toBe("Active");
    expect(requests).toEqual([
      {
        action: "CreateAssetGroup",
        body: { Name: "portrait group", Description: "", GroupType: "AIGC", ProjectName: "default" },
      },
      {
        action: "CreateAsset",
        body: {
          GroupId: "group-1",
          URL: "https://example.test/portrait.jpg",
          Name: "portrait",
          AssetType: "Image",
          ProjectName: "default",
        },
      },
      { action: "GetAsset", body: { Id: "asset-1", ProjectName: "default" } },
    ]);
  });

  test("uses the Ark deletion actions once for custom portraits and their group", async () => {
    const requests: Array<{ action: string; body: Record<string, unknown> }> = [];
    const client = new ArkAssetsClient(config, async (url, init) => {
      requests.push({
        action: new URL(String(url)).searchParams.get("Action") ?? "",
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return Response.json({ Result: {} });
    });

    await client.deleteAsset("asset-1", "project-1");
    await client.deleteAssetGroup("group-1", "project-1");

    expect(requests).toEqual([
      { action: "DeleteAsset", body: { Id: "asset-1", ProjectName: "project-1" } },
      { action: "DeleteAssetGroup", body: { Id: "group-1", ProjectName: "project-1" } },
    ]);
  });
});
