import { describe, expect, test } from "bun:test";
import { creationCapabilities, quoteCreation, validateCreationValues } from "../../server/creation/capabilities";

const models = creationCapabilities(() => true);

describe("AI creation capability contract", () => {
  test("uses the product-specific defaults without exposing unintegrated video models", () => {
    const video = models.filter((item) => item.kind === "video");
    expect(video).toHaveLength(3);
    expect(video.filter((item) => item.isDefault).map((item) => item.id)).toEqual(["doubao-seedance-2-0-260128"]);
    expect(
      video.every((item) => item.maxOutputs === 1 && !item.supportsSeed && item.referenceModes.join(",") === "omni"),
    ).toBeTrue();
    expect(video.every((item) => !item.supportedResolutions.includes("1080p"))).toBeTrue();
  });

  test("marks unavailable image providers as explicit Mock capabilities", () => {
    const images = models.filter((item) => item.kind === "image");
    expect(images).toHaveLength(7);
    expect(images.every((item) => item.executionMode === "mock")).toBeTrue();
    expect(images.find((item) => item.isDefault)?.dimensions?.["2k"]?.["4:3"]).toEqual({ width: 2304, height: 1728 });
  });

  test("rejects unsupported paid parameters before queueing", () => {
    const valid = {
      creationKind: "video",
      type: "视频",
      prompt: "测试",
      modelId: "doubao-seedance-2-0-260128",
      ratio: "9:16",
      resolution: "720p",
      count: "1",
      referenceMode: "omni",
      duration: "5",
      seed: "",
    };
    expect(validateCreationValues(valid, models)).toBeUndefined();
    expect(validateCreationValues({ ...valid, resolution: "1080p" }, models)).toContain("清晰度");
    expect(validateCreationValues({ ...valid, count: "2" }, models)).toContain("数量");
    expect(validateCreationValues({ ...valid, seed: "42" }, models)).toContain("种子");
    expect(quoteCreation(valid, models)).toBe(70);
  });
});
