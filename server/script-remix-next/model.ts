import { z } from "zod";
import {
  normalizeScriptRemixNextShots,
  type ScriptRemixNextShot,
  scriptRemixNextAnalysisModel,
  scriptRemixNextCompletePrompt,
} from "../../shared/script-remix-next/workflow";
import { aihubmix } from "../providers/aihubmix";

const RawShotSchema = z.object({
  title: z.string().trim().min(1).max(80),
  speech: z.string().trim().min(1).max(4_000),
  visual: z.string().trim().min(5).max(2_000),
  action: z.string().trim().min(1).max(1_000),
  camera: z.string().trim().min(1).max(500),
  durationSeconds: z.number().positive().max(60),
  productRequirement: z.string().trim().max(1_000).default(""),
  characterRequirement: z.string().trim().max(1_000).default(""),
  prompt: z.string().trim().min(20).max(8_000).optional(),
});

const ResponseSchema = z.object({ shots: z.array(RawShotSchema).min(1).max(30) });

function jsonObject(text: string) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("SCRIPT_REMIX_NEXT_JSON_NOT_FOUND");
  return JSON.parse(cleaned.slice(start, end + 1)) as unknown;
}

export function parseScriptRemixNextAnalysis(text: string): ScriptRemixNextShot[] {
  const parsed = ResponseSchema.parse(jsonObject(text));
  return normalizeScriptRemixNextShots(
    parsed.shots.map((shot, index) => ({
      ...shot,
      id: crypto.randomUUID(),
      ordinal: index + 1,
      prompt: scriptRemixNextCompletePrompt(shot),
    })),
  );
}

export function buildScriptRemixNextAnalysisPrompt(input: {
  script: string;
  productName: string;
  productDescription: string;
  portraitName?: string;
  voiceName?: string;
}) {
  return `你是中文短视频脚本导演。将用户上传的完整脚本文档解析成连续、可拍摄的视频分镜，只返回 JSON，不输出 Markdown 或解释。

输出格式：
{"shots":[{"title":"分镜标题","speech":"该镜头对应的完整原文","visual":"画面主体、场景和构图","action":"人物和商品的连续动作","camera":"景别、机位和运镜","durationSeconds":8,"productRequirement":"商品一致性要求","characterRequirement":"人物一致性要求","prompt":"包含口播、画面、动作、运镜、商品和人物一致性要求的完整生成提示词"}]}

规则：
1. 根据内容自然拆分，不必凑满 9 条；最多输出 9 条。如果自然拆分超过 9 条，合并相邻内容压缩到 9 条且不得遗漏原文。
2. 所有 speech 按顺序拼接并移除空白后，必须与原脚本移除空白后的内容一致，不得改写、删减、重复或调序。
3. 每条分镜说明具体、可执行，时长与口播长度匹配。
4. 商品和人物跨镜头保持一致，不虚构未提供的商品事实。
5. prompt 必须是可直接用于图片和视频生成的完整中文提示词，完整包含该分镜的口播、画面、动作、镜头、商品一致性和人物一致性信息。

商品：${input.productName}
商品说明：${input.productDescription || "未提供"}
人像：${input.portraitName || "未选择"}
音色：${input.voiceName || "未选择"}

<script-document>
${input.script}
</script-document>`;
}

export async function analyzeScriptRemixNext(input: Parameters<typeof buildScriptRemixNextAnalysisPrompt>[0]) {
  const response = await aihubmix.generateText(
    buildScriptRemixNextAnalysisPrompt(input),
    scriptRemixNextAnalysisModel,
    {
      maxTokens: 12_000,
      temperature: 0.3,
      json: true,
      timeoutMs: 180_000,
    },
  );
  return { shots: parseScriptRemixNextAnalysis(response.text), model: response.model, usage: response.usage };
}

export function buildStoryboardGridPrompt(input: {
  shots: readonly ScriptRemixNextShot[];
  productName: string;
  portraitName?: string;
}) {
  const cells = Array.from({ length: 9 }, (_, index) => {
    const shot = input.shots[index];
    return shot
      ? `${index + 1}. ${shot.title}：${scriptRemixNextCompletePrompt(shot)}`
      : `${index + 1}. 空白占位格：纯浅灰背景，中央仅显示“空白”，不得出现人物、商品或场景`;
  });
  return `生成一张严格 3×3、九格等宽等高、边界清晰的专业短视频分镜稿。整体为 9:16 竖版画布，阅读顺序从左到右、从上到下。每格左上角标注对应数字 1–9。有效格保持同一人物、同一商品、同一服装和统一写实风格；不要加入平台 UI、按钮、水印或额外文字。

商品：${input.productName}
人物：${input.portraitName || "按脚本设定"}
${cells.join("\n")}`;
}

export function buildSingleShotImagePrompt(input: {
  shot: ScriptRemixNextShot;
  productName: string;
  portraitName?: string;
}) {
  return `生成一个 9:16 竖版短视频分镜参考画面，不要九宫格，不要文字、水印或平台 UI。
商品：${input.productName}
人物：${input.portraitName || "按脚本设定"}
完整提示词：
${scriptRemixNextCompletePrompt(input.shot)}`;
}
