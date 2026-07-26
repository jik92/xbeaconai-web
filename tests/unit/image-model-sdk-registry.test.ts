import { describe, expect, test } from "bun:test";
import { imageModelDefinitions } from "../../server/creation/image-models";
import { sdkRegistry } from "../../server/sdk-registry";

describe("real image model SDK registry", () => {
  test("registers a live test adapter for every provider-backed image model", () => {
    const imageEntries = sdkRegistry.filter((entry) => entry.capability.startsWith("image-generate"));

    expect(imageEntries.map((entry) => entry.model)).toEqual(imageModelDefinitions.map((model) => model.providerModel));
    expect(imageEntries.map((entry) => entry.testAdapter)).toEqual([
      "test-image-openai",
      "test-image-seedream",
      "test-image-seedream",
      "test-image-seedream",
      "test-image-gemini-interactions",
      "test-image-gemini-content",
      "test-image-openai-edit",
    ]);
  });
});
