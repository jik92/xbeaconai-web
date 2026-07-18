import { describe, expect, test } from "bun:test";
import { modules } from "../../src/app/routes";
import { auditUiFeatureRegistry, uiFeatureRegistry } from "../../src/app/ui-feature-registry";

describe("UI feature registry", () => {
  test("registers every visible module field and result action", () => {
    expect(() => auditUiFeatureRegistry()).not.toThrow();
    for (const module of modules) {
      for (const field of module.fields) expect(uiFeatureRegistry.some((entry) => entry.id === `${module.id}:field:${field.id}` || module.id === "video-remix")).toBeTrue();
      for (const action of module.result.actions) expect(uiFeatureRegistry.some((entry) => entry.moduleId === module.id && entry.action === action)).toBeTrue();
    }
  });
});
