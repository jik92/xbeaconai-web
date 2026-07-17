import { describe, expect, test } from "bun:test";
import { modules } from "../../src/app/routes";

describe("module business specifications", () => {
  test("defines all twelve distinct creation modules", () => {
    expect(modules).toHaveLength(12);
    expect(new Set(modules.map((module) => module.id)).size).toBe(12);
    expect(new Set(modules.map((module) => module.path)).size).toBe(12);
  });

  test("every module declares an executable, module-specific workflow", () => {
    for (const module of modules) {
      expect(module.steps.length).toBeGreaterThanOrEqual(3);
      expect(module.fields.length).toBeGreaterThanOrEqual(3);
      expect(module.fields.some((field) => field.required)).toBe(true);
      expect(module.result.kind).toBeString();
      expect(module.result.actions.length).toBeGreaterThanOrEqual(2);
      expect(module.cost).toBeGreaterThan(0);
    }
    expect(new Set(modules.map((module) => module.result.kind)).size).toBeGreaterThanOrEqual(6);
  });
});
