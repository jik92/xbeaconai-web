import { describe, expect, test } from "bun:test";
import { validateRemixShotReferenceBindings } from "../../shared/video-remix/shot-reference";

describe("video remix shot references", () => {
  test("accepts only submitted labels which are explicitly mentioned", () => {
    expect(
      validateRemixShotReferenceBindings("请让 @Image2 展示商品，并保持镜头稳定。", [{ label: "Image2" }]),
    ).toBeUndefined();
  });

  test("accepts a mention immediately after Chinese prompt text", () => {
    expect(validateRemixShotReferenceBindings("请参考@Image1完成镜头。", [{ label: "Image1" }])).toBeUndefined();
  });

  test("rejects prompt labels which are not bound to a material", () => {
    expect(validateRemixShotReferenceBindings("请参考 @Image3 完成镜头。", [{ label: "Image1" }])).toBe(
      "@Image3 未绑定到参考素材",
    );
  });

  test("rejects submitted materials which are absent from the prompt", () => {
    expect(
      validateRemixShotReferenceBindings("请参考 @Image1 完成镜头。", [{ label: "Image1" }, { label: "Image2" }]),
    ).toBe("提示词缺少 @Image2 引用");
  });

  test("rejects duplicate material labels", () => {
    expect(
      validateRemixShotReferenceBindings("请参考 @Image1 完成镜头。", [{ label: "Image1" }, { label: "Image1" }]),
    ).toBe("参考素材标签不能重复");
  });
});
