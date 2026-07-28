import { sign, verify } from "hono/jwt";
import { z } from "zod";

const issuer = "yaozuo-download";
const audience = "yaozuo-browser-attachment";
const ticketTtlSeconds = 60;

export const DownloadResourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("artifact"), artifactId: z.string().uuid() }),
  z.object({ kind: z.literal("job-text"), jobId: z.string().uuid() }),
  z.object({
    kind: z.literal("ad-script"),
    projectId: z.string().uuid(),
    variantId: z.string().uuid(),
    versionId: z.string().uuid().optional(),
    format: z.enum(["txt", "md"]),
  }),
  z.object({ kind: z.literal("admin-env") }),
]);

const DownloadTicketSchema = z.object({
  purpose: z.literal("browser-attachment-download"),
  sub: z.string().uuid(),
  resource: DownloadResourceSchema,
  iat: z.number().int(),
  exp: z.number().int(),
  iss: z.literal(issuer),
  aud: z.literal(audience),
});

export type DownloadResource = z.infer<typeof DownloadResourceSchema>;
export type DownloadTicket = z.infer<typeof DownloadTicketSchema>;
export type DownloadTicketInput = Pick<DownloadTicket, "sub" | "resource">;

export async function issueDownloadTicket(input: DownloadTicketInput, secret: string) {
  const iat = Math.floor(Date.now() / 1000);
  const payload: DownloadTicket = {
    ...input,
    purpose: "browser-attachment-download",
    iat,
    exp: iat + ticketTtlSeconds,
    iss: issuer,
    aud: audience,
  };
  return {
    token: await sign(payload, secret, "HS256"),
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

export async function verifyDownloadTicket(token: string, secret: string) {
  const payload = await verify(token, secret, { alg: "HS256", iss: issuer, aud: audience });
  return DownloadTicketSchema.parse(payload);
}
