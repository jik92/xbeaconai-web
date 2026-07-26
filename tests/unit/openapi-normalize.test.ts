import { describe, expect, test } from "bun:test";
import { normalizeOpenApi31ExclusiveBounds } from "../../scripts/openapi-normalize";

describe("OpenAPI 3.1 normalization", () => {
  test("converts legacy boolean exclusive bounds recursively", () => {
    expect(
      normalizeOpenApi31ExclusiveBounds({
        type: "object",
        properties: {
          budget: { type: "number", minimum: 0, exclusiveMinimum: true },
          ratio: { type: "number", maximum: 1, exclusiveMaximum: true },
        },
      }),
    ).toEqual({
      type: "object",
      properties: {
        budget: { type: "number", exclusiveMinimum: 0 },
        ratio: { type: "number", exclusiveMaximum: 1 },
      },
    });
  });

  test("preserves numeric bounds and unrelated values", () => {
    const schema = { type: "number", minimum: 0, exclusiveMinimum: 1 };
    expect(normalizeOpenApi31ExclusiveBounds(schema)).toEqual(schema);
  });
});
