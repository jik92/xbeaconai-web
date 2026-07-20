import { describe, expect, test } from "bun:test";
import {
  directUploadExtensions,
  issueDirectUploadTicket,
  maxDirectUploadBytes,
  verifyDirectUploadTicket,
} from "../../server/uploads/direct-upload";

const ticketInput = {
  sub: "64b0c0d9-ab1b-42c6-85b0-8a902d8f360e",
  assetId: "78e61272-6ffb-423e-b1df-3f65e03bf5ac",
  storageKey:
    "64b0c0d9-ab1b-42c6-85b0-8a902d8f360e/materials/9c4235eb-112e-40f8-8af8-a4a645075206/78e61272-6ffb-423e-b1df-3f65e03bf5ac.mp4",
  originalName: "demo.mp4",
  mimeType: "video/mp4",
  byteSize: 9_781_992,
  width: 1080,
  height: 1920,
  durationSec: 15.09,
  kind: "media" as const,
  displayName: "演示视频",
  folderId: "9c4235eb-112e-40f8-8af8-a4a645075206",
};

describe("direct TOS upload ticket", () => {
  test("round-trips immutable asset metadata through a short-lived signed token", async () => {
    const secret = "test-secret-that-never-leaves-the-server";
    const issued = await issueDirectUploadTicket(ticketInput, secret);
    const verified = await verifyDirectUploadTicket(issued.token, secret);

    expect(verified).toMatchObject(ticketInput);
    expect(verified.purpose).toBe("direct-asset-upload");
    expect(new Date(issued.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  test("rejects a token signed by another secret", async () => {
    const issued = await issueDirectUploadTicket(ticketInput, "right-secret");
    expect(verifyDirectUploadTicket(issued.token, "wrong-secret")).rejects.toThrow();
  });

  test("publishes the same MP4 type and size limits enforced by the upload API", () => {
    expect(directUploadExtensions["video/mp4"]).toBe(".mp4");
    expect(maxDirectUploadBytes).toBe(500 * 1024 * 1024);
  });
});
