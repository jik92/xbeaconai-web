import { describe, expect, test } from "bun:test";
import { assetIdsFromValues } from "../../worker/jobs/utils";

describe("worker asset reference parsing", () => {
  test("includes AI Generate referenceAssetIds in the Seedance reference list", () => {
    expect(
      assetIdsFromValues({
        referenceAssetIds: JSON.stringify([
          "22222222-2222-4222-8222-222222222222",
          "33333333-3333-4333-8333-333333333333",
        ]),
      }),
    ).toEqual(["22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"]);
  });
});
