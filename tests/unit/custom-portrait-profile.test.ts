import { describe, expect, test } from "bun:test";

describe("custom portrait profile contract", () => {
  test("requires a persisted gender in the registration API", async () => {
    const spec = await Bun.file("openapi/openapi.json").json();
    const schema = spec.paths["/api/portraits/custom"].post.requestBody.content["application/json"].schema;
    expect(schema.required).toContain("gender");
    expect(schema.properties.gender.enum).toEqual(["男", "女"]);
    const portrait =
      spec.paths["/api/portraits/custom"].get.responses["200"].content["application/json"].schema.properties.portraits
        .items;
    expect(portrait.properties.gender.enum).toEqual(["男", "女"]);
  });

  test("renders the approved self-built portrait fields and submits them together", async () => {
    const page = await Bun.file("web/features/portrait-library/portrait-library.tsx").text();
    const client = await Bun.file("web/api/api-client.ts").text();
    expect(page).toContain('title="新建自建虚拟人像"');
    expect(page).toContain("基础描述");
    expect(page).toContain('<option value="男">男</option>');
    expect(page).toContain('<option value="女">女</option>');
    expect(page).toContain("createCustomPortrait(portraitFile, portraitName.trim(), portraitGender");
    expect(client).toContain("body: { assetId: asset.id, gender }");
  });
});
