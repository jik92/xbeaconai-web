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
  test("reports enabled Seedance models as Mock when local video generation is selected", () => {
    const mockModels = creationCapabilities(() => true, "mock").filter((model) => model.kind === "video");
    expect(mockModels.length).toBeGreaterThan(0);
    expect(mockModels.every((model) => model.enabled && model.executionMode === "mock")).toBeTrue();
  });

  test("publishes one default mock image model and only enabled real video models", () => {
    const imageModels = models.filter((model) => model.kind === "image");
    const videoModels = models.filter((model) => model.kind === "video");

    expect(imageModels).not.toHaveLength(0);
    expect(imageModels.filter((model) => model.isDefault)).toHaveLength(1);
    expect(imageModels.every((model) => model.executionMode === "mock" && model.enabled)).toBe(true);
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
      count: "2",
      referenceMode: "",
      duration: "",
      seed: "123",
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
