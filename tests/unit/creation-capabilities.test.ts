import { describe, expect, test } from "bun:test";
import { creationCapabilities, quoteCreation, validateCreationValues } from "../../server/creation/capabilities";

const models = creationCapabilities((id) => id.endsWith("fast-260128"));
const imageModel = models.find((model) => model.kind === "image");
const enabledVideoModel = models.find((model) => model.kind === "video" && model.enabled);
const disabledVideoModel = models.find((model) => model.kind === "video" && !model.enabled);

if (!imageModel || !enabledVideoModel || !disabledVideoModel) {
  throw new Error("Expected image, enabled video, and disabled video capabilities");
}

describe("creation capabilities", () => {
  test("publishes every enabled Seedance model as real", () => {
    const videoModels = creationCapabilities(() => true).filter((model) => model.kind === "video");
    expect(videoModels.length).toBeGreaterThan(0);
    expect(videoModels.every((model) => model.enabled && model.executionMode === "real")).toBeTrue();
  });

  test("publishes only the seven provider-backed image models and enabled real video models", () => {
    const imageModels = models.filter((model) => model.kind === "image");
    const videoModels = models.filter((model) => model.kind === "video");

    expect(imageModels.map((model) => model.id)).toEqual([
      "gpt-image-1-mini",
      "seedream-5-lite",
      "seedream-4-5",
      "seedream-4-0",
      "nano-banana-2",
      "nano-banana-pro",
      "gpt-image-2-stable",
    ]);
    expect(imageModels.filter((model) => model.isDefault)).toHaveLength(1);
    expect(imageModels.find((model) => model.isDefault)).toMatchObject({
      id: "gpt-image-1-mini",
      executionMode: "real",
      enabled: true,
      supportedRatios: ["1:1", "3:2", "2:3"],
      supportedResolutions: ["1k"],
    });
    expect(imageModels.every((model) => model.executionMode === "real" && model.enabled)).toBeTrue();
    expect(imageModels.find((model) => model.id === "gpt-image-2-stable")).toMatchObject({
      minReferences: 1,
      maxReferences: 1,
    });
    expect(imageModels.find((model) => model.id === "nano-banana-2")).toMatchObject({
      minReferences: 0,
      maxReferences: 0,
    });
    expect(videoModels.filter((model) => model.isDefault)).toHaveLength(1);
    expect(enabledVideoModel.executionMode).toBe("real");
    expect(disabledVideoModel.disabledReason).toBe("真实基线尚未验证");
  });

  test("validates model capability constraints before task creation", () => {
    const validImageValues = {
      creationKind: "image",
      modelId: imageModel.id,
      prompt: "一顶草编礼帽的电商主图",
      ratio: "1:1",
      resolution: "1k",
      count: "1",
      referenceMode: "",
      duration: "",
      seed: "",
    };

    expect(validateCreationValues(validImageValues, models)).toBeUndefined();
    expect(validateCreationValues({ ...validImageValues, creationKind: "audio" }, models)).toBe("请选择创作类型");
    expect(validateCreationValues({ ...validImageValues, modelId: disabledVideoModel.id }, models)).toBe(
      "所选模型当前不可用",
    );
    expect(validateCreationValues({ ...validImageValues, count: "9" }, models)).toBe("生成数量超出模型能力");
    expect(validateCreationValues({ ...validImageValues, ratio: "3:1" }, models)).toBe("所选模型不支持该画幅");
  });

  test("enforces video-only options and calculates output-based image credits", () => {
    const validVideoValues = {
      creationKind: "video",
      modelId: enabledVideoModel.id,
      prompt: "产品展示视频",
      ratio: "16:9",
      resolution: "720p",
      count: "1",
      referenceMode: "omni",
      duration: "5",
      seed: "",
    };

    expect(validateCreationValues(validVideoValues, models)).toBeUndefined();
    expect(validateCreationValues({ ...validVideoValues, referenceMode: "none" }, models)).toBe(
      "所选模型不支持该参考模式",
    );
    expect(validateCreationValues({ ...validVideoValues, duration: "3" }, models)).toBe("所选模型不支持该视频时长");
    expect(validateCreationValues({ ...validVideoValues, seed: "42" }, models)).toBe("所选模型不支持种子值");
    expect(quoteCreation({ creationKind: "image", modelId: imageModel.id, count: "3" }, models)).toBe(210);
    expect(quoteCreation({ creationKind: "image", modelId: "unknown", count: "3" }, models)).toBe(0);
  });
});
