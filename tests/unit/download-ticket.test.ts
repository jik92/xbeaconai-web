import { describe, expect, test } from "bun:test";
import { sign } from "hono/jwt";
import { issueDownloadTicket, verifyDownloadTicket } from "../../server/downloads/download-ticket";

const secret = "download-ticket-secret-at-least-32-characters";
const userId = "00000000-0000-4000-8000-000000000001";

describe("attachment download ticket", () => {
  test("round-trips one owned resource for sixty seconds", async () => {
    const issued = await issueDownloadTicket(
      {
        sub: userId,
        resource: {
          kind: "job-text",
          jobId: "00000000-0000-4000-8000-000000000002",
        },
      },
      secret,
    );

    const payload = await verifyDownloadTicket(issued.token, secret);
    expect(payload.sub).toBe(userId);
    expect(payload.resource).toEqual({
      kind: "job-text",
      jobId: "00000000-0000-4000-8000-000000000002",
    });
    expect(payload.exp - payload.iat).toBe(60);
    expect(issued.expiresAt).toBe(new Date(payload.exp * 1000).toISOString());
  });

  test("rejects a ticket signed with another secret", async () => {
    const issued = await issueDownloadTicket(
      {
        sub: userId,
        resource: {
          kind: "artifact",
          artifactId: "00000000-0000-4000-8000-000000000003",
        },
      },
      secret,
    );

    await expect(verifyDownloadTicket(issued.token, "another-download-secret-at-least-32-chars")).rejects.toThrow();
  });

  test("rejects a signed payload with an unknown resource kind", async () => {
    const iat = Math.floor(Date.now() / 1000);
    const token = await sign(
      {
        purpose: "browser-attachment-download",
        sub: userId,
        resource: { kind: "arbitrary-path", path: "/etc/passwd" },
        iat,
        exp: iat + 60,
        iss: "yaozuo-download",
        aud: "yaozuo-browser-attachment",
      },
      secret,
      "HS256",
    );

    await expect(verifyDownloadTicket(token, secret)).rejects.toThrow();
  });
});
