import { z } from "zod";

const revisionModeSchema = z.enum(["new", "edit", "variant"]);
const referenceAssetIdsSchema = z.array(z.string().uuid()).max(12);

const commonRequestShape = {
  title: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1).max(10_000),
  modelId: z.string().trim().min(1).max(120),
  ratio: z.string().trim().min(1).max(20),
  resolution: z.string().trim().min(1).max(20),
  referenceAssetIds: referenceAssetIdsSchema,
  parentJobId: z.string().uuid().optional(),
  revisionMode: revisionModeSchema,
};

const imageRequestSchema = z
  .object({
    ...commonRequestShape,
    kind: z.literal("image"),
    count: z.number().int().min(1).max(8),
  })
  .strict();

const videoRequestSchema = z
  .object({
    ...commonRequestShape,
    kind: z.literal("video"),
    duration: z.number().int().min(4).max(15),
    referenceMode: z.string().trim().min(1).max(40),
  })
  .strict();

export const AiGenerateRequestSchema = z.discriminatedUnion("kind", [imageRequestSchema, videoRequestSchema]);
export type AiGenerateRequest = z.infer<typeof AiGenerateRequestSchema>;

export function normalizeAiGenerateValues(request: AiGenerateRequest): Record<string, string> {
  return {
    kind: request.kind,
    title: request.title,
    prompt: request.prompt,
    modelId: request.modelId,
    ratio: request.ratio,
    resolution: request.resolution,
    referenceAssetIds: JSON.stringify(request.referenceAssetIds),
    revisionMode: request.revisionMode,
    ...(request.parentJobId ? { parentJobId: request.parentJobId } : {}),
    ...(request.kind === "image"
      ? { count: String(request.count) }
      : { duration: String(request.duration), referenceMode: request.referenceMode }),
  };
}

export function parseAiGenerateJobValues(values: Record<string, string>): AiGenerateRequest {
  let referenceAssetIds: unknown;
  try {
    referenceAssetIds = JSON.parse(values.referenceAssetIds);
  } catch {
    throw new Error("AI_GENERATE_VALUES_INVALID");
  }
  const parsed = AiGenerateRequestSchema.safeParse({
    kind: values.kind,
    title: values.title,
    prompt: values.prompt,
    modelId: values.modelId,
    ratio: values.ratio,
    resolution: values.resolution,
    referenceAssetIds,
    parentJobId: values.parentJobId || undefined,
    revisionMode: values.revisionMode,
    ...(values.kind === "image"
      ? { count: Number(values.count) }
      : { duration: Number(values.duration), referenceMode: values.referenceMode }),
  });
  if (!parsed.success) throw new Error("AI_GENERATE_VALUES_INVALID");
  return parsed.data;
}
