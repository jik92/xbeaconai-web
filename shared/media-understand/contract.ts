import { z } from "zod";

export const mediaUnderstandModelIds = [
  "doubao-seed-2-0-pro-260215",
  "doubao-seed-2-1-pro-260628",
  "doubao-seed-2-0-lite-260428",
  "doubao-seed-2-0-mini-260428",
] as const;

export type MediaUnderstandModelId = (typeof mediaUnderstandModelIds)[number];

export const mediaUnderstandModels: ReadonlyArray<{
  id: MediaUnderstandModelId;
  displayName: string;
  description: string;
  badges: string[];
  acceptedPrimaryKinds: Array<"image" | "video" | "audio">;
}> = [
  {
    id: "doubao-seed-2-0-pro-260215",
    displayName: "字节Seed 2.0 Pro",
    description: "侧重长链路推理与复杂任务稳定性",
    badges: [],
    acceptedPrimaryKinds: ["image", "video"],
  },
  {
    id: "doubao-seed-2-1-pro-260628",
    displayName: "字节Seed 2.1 Pro",
    description: "面向生产级任务，全面升级编程、智能体与多模态能力",
    badges: ["模型上新"],
    acceptedPrimaryKinds: ["image", "video"],
  },
  {
    id: "doubao-seed-2-0-lite-260428",
    displayName: "字节Seed 2.0 Lite",
    description: "支持视频、图像、音频与文本的全模态理解",
    badges: [],
    acceptedPrimaryKinds: ["image", "video", "audio"],
  },
  {
    id: "doubao-seed-2-0-mini-260428",
    displayName: "字节Seed 2.0 Mini",
    description: "更短思考长度与更高 Token 效率",
    badges: [],
    acceptedPrimaryKinds: ["image", "video", "audio"],
  },
];

export const mediaUnderstandReasoningEfforts = ["off", "medium", "high"] as const;
export type MediaUnderstandReasoningEffort = (typeof mediaUnderstandReasoningEfforts)[number];

export const MediaUnderstandRequestSchema = z
  .object({
    modelId: z.enum(mediaUnderstandModelIds),
    reasoningEffort: z.enum(mediaUnderstandReasoningEfforts),
    prompt: z.string().trim().max(8_000).default(""),
    primaryAssetId: z.uuid(),
    referenceImageAssetIds: z.array(z.uuid()).max(5).default([]),
    idempotencyKey: z.uuid(),
  })
  .superRefine((value, context) => {
    const allIds = [value.primaryAssetId, ...value.referenceImageAssetIds];
    if (new Set(allIds).size !== allIds.length)
      context.addIssue({
        code: "custom",
        path: ["referenceImageAssetIds"],
        message: "主素材与商品参考图不能重复",
      });
  });

export type MediaUnderstandRequest = z.infer<typeof MediaUnderstandRequestSchema>;

const ShotSchema = z
  .object({
    shot_number: z.number().int().positive(),
    start_seconds: z.number().nonnegative(),
    end_seconds: z.number().positive(),
    duration_seconds: z.number().positive(),
    visual: z.string(),
    original_dialogue: z.string(),
    rewritten_dialogue: z.string(),
    action: z.string(),
    shot_type: z.string(),
    camera_movement: z.string(),
    transition: z.string(),
    product_replacement: z.string(),
    audio: z.string(),
  })
  .superRefine((shot, context) => {
    if (shot.end_seconds <= shot.start_seconds)
      context.addIssue({ code: "custom", path: ["end_seconds"], message: "镜头结束时间必须晚于开始时间" });
    if (Math.abs(shot.end_seconds - shot.start_seconds - shot.duration_seconds) > 0.05)
      context.addIssue({ code: "custom", path: ["duration_seconds"], message: "镜头时长必须等于结束时间减开始时间" });
  });

export const MediaUnderstandResultSchema = z
  .object({
    title: z.string().min(1),
    source_summary: z.string(),
    replacement_brief: z.string(),
    global_settings: z.object({
      product: z.string(),
      audience: z.string(),
      tone: z.string(),
      duration_seconds: z.number().nonnegative(),
    }),
    shots: z.array(ShotSchema).min(1),
  })
  .superRefine((value, context) => {
    for (const [index, shot] of value.shots.entries()) {
      if (shot.shot_number !== index + 1)
        context.addIssue({ code: "custom", path: ["shots", index, "shot_number"], message: "镜头编号必须连续" });
      const previous = value.shots[index - 1];
      if (previous && shot.start_seconds < previous.end_seconds)
        context.addIssue({ code: "custom", path: ["shots", index, "start_seconds"], message: "镜头时间轴不能重叠" });
    }
  });

export type MediaUnderstandResult = z.infer<typeof MediaUnderstandResultSchema>;

export function stripJsonFence(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

export function extractMediaUnderstandResult(value: string): MediaUnderstandResult {
  return MediaUnderstandResultSchema.parse(JSON.parse(stripJsonFence(value)));
}

export function buildMediaUnderstandPrompt(input: {
  userPrompt: string;
  primaryMimeType: string;
  referenceImageCount: number;
  repairText?: string;
}) {
  const mediaKind = input.primaryMimeType.startsWith("video/")
    ? "视频"
    : input.primaryMimeType.startsWith("audio/")
      ? "音频"
      : "图片";
  const request = input.userPrompt.trim() || "完整理解素材，并生成可直接用于重新拍摄和制作的镜头脚本。";
  const repair = input.repairText
    ? `\n上一次输出未通过 JSON 结构校验。请依据原任务重新输出完整 JSON，不要解释错误，也不要省略字段。\n`
    : "";
  return `你是一名短视频导演、视听语言分析师和电商带货脚本专家。

主素材类型：${mediaKind}
商品参考图数量：${input.referenceImageCount}
用户改写要求：${request}
${repair}
请完整理解主素材中的画面、声音、对白、人物动作、商品展示、节奏和镜头边界，然后生成一份改写后的镜头脚本。
若用户要求替换商品，必须保留原素材有效的镜头结构和营销逻辑，同时把原商品替换成参考图中的目标商品。
商品外观、材质、结构、颜色和可见文字以参考图为准；看不清的品牌、规格和功效不得臆造。

视频必须精确拆分每个镜头的开始与结束秒数，并尽可能逐字还原 original_dialogue。
rewritten_dialogue 是替换商品后可直接拍摄的中文带货口播。
图片允许输出一个镜头；音频没有可验证画面时 visual 必须明确写“无可验证画面”，不得虚构。

只返回一个合法 JSON 对象，不要 Markdown 代码围栏、解释、思考过程或额外文本。结构严格为：
{
  "title": "脚本标题",
  "source_summary": "原素材内容与营销结构概述",
  "replacement_brief": "商品替换和改写要求",
  "global_settings": {
    "product": "改写后的目标商品",
    "audience": "目标受众",
    "tone": "整体语气",
    "duration_seconds": 0
  },
  "shots": [{
    "shot_number": 1,
    "start_seconds": 0,
    "end_seconds": 0,
    "duration_seconds": 0,
    "visual": "画面中可验证的主体、环境、构图和光线",
    "original_dialogue": "原素材在该时间段说的话；无对白则为空字符串",
    "rewritten_dialogue": "替换商品后的完整口播",
    "action": "可执行的人物与商品动作",
    "shot_type": "景别",
    "camera_movement": "机位与运镜",
    "transition": "与前后镜头的衔接",
    "product_replacement": "该镜头如何把原商品替换为目标商品",
    "audio": "人声、语气、音乐和环境声"
  }]
}

约束：
1. shot_number 从 1 连续递增。
2. end_seconds 必须大于 start_seconds，duration_seconds 必须等于两者之差。
3. 镜头时间不能重叠；视频镜头应连续覆盖完整素材时间轴。
4. 所有数值使用秒，可保留两位小数。
5. 每个镜头必须独立完整，不使用“同上”等省略表达。`;
}
