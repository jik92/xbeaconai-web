import { sign, verify } from "hono/jwt";
import { z } from "zod";

export const maxDirectUploadBytes = 500 * 1024 * 1024;
export const directUploadExtensions: Readonly<Record<string, string>> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/ogg": ".ogg",
  "audio/mp4": ".m4a",
  "audio/webm": ".webm",
};

const issuer = "yaozuo-direct-upload";
const audience = "yaozuo-upload-confirm";
const ticketTtlSeconds = 15 * 60;

const DirectUploadTicketSchema = z.object({
  purpose: z.literal("direct-asset-upload"),
  sub: z.string().uuid(),
  assetId: z.string().uuid(),
  storageKey: z.string().min(1),
  originalName: z.string().min(1).max(200),
  mimeType: z.string().min(1),
  byteSize: z.number().int().positive().max(maxDirectUploadBytes),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationSec: z.number().positive().optional(),
  kind: z.literal("media"),
  displayName: z.string().min(1).max(80),
  description: z.string().max(300).optional(),
  folderId: z.string().uuid(),
  iat: z.number().int(),
  exp: z.number().int(),
  iss: z.literal(issuer),
  aud: z.literal(audience),
});

export type DirectUploadTicket = z.infer<typeof DirectUploadTicketSchema>;
export type DirectUploadTicketInput = Omit<DirectUploadTicket, "purpose" | "iat" | "exp" | "iss" | "aud">;

export async function issueDirectUploadTicket(input: DirectUploadTicketInput, secret: string) {
  const iat = Math.floor(Date.now() / 1000);
  const payload: DirectUploadTicket = {
    ...input,
    purpose: "direct-asset-upload",
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

export async function verifyDirectUploadTicket(token: string, secret: string) {
  const payload = await verify(token, secret, { alg: "HS256", iss: issuer, aud: audience });
  return DirectUploadTicketSchema.parse(payload);
}
