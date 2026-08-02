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
      ? `格 ${index + 1}｜${shot.title}
${scriptRemixNextCompletePrompt(shot)}
只呈现一个明确视觉重点；口播用于理解叙事意图，画面中不要出现口播文字。`
      : `格 ${index + 1}｜空白占位
均匀的中性浅灰色纯背景，无人物、无商品、无场景、无文字、无符号。`;
  });
  return `【任务】
生成一张可直接切分并用于 Seedance 2.0 视频参考的专业电商分镜接触表。最终画布为 1024×1536 竖版，严格 3 列×3 行；九格尺寸完全一致，使用清晰、笔直、等宽的浅灰分隔线。阅读顺序固定为从左到右、从上到下。每格只能是一张完整画面，禁止格中格、拼贴、跨格主体和跨格背景。

【参考图优先级】
输入图片是事实来源而非风格建议。严格还原所选商品“${input.productName}”的几何轮廓、比例、颜色、包装结构、Logo 与印刷位置、材质纹理和关键细节，不得重新设计、换色、增删部件或生成近似替代品。${input.portraitName ? `严格保持人物“${input.portraitName}”的脸型、五官、发型、服装和体型一致。` : "如画面出现同一人物，所有有效格保持同一张脸、同一发型、同一服装和同一体型。"}

【统一视觉圣经】
写实电商短视频定帧，真实摄影而非插画。自然皮肤纹理、可见但克制的毛孔和肤色变化，衣物有真实褶皱，商品材质有准确高光、粗糙度和接触阴影。主光源方向明确，柔和补光，曝光准确，白平衡自然，亮部不过曝，暗部保留层次。前景轻微虚化，中景主体锐利，背景有自然景深和生活化细节；人物、手和商品之间遵守重力、支撑、遮挡和接触关系。清晰对焦、丰富细节、自然色彩、专业商业摄影质感，不过度磨皮，不过度锐化。

【分镜组织】
本次恰好只有 ${input.shots.length} 个有效格：仅格 1 至格 ${input.shots.length} 可以出现画面，其余 ${9 - input.shots.length} 格必须保持纯灰空白，绝对禁止擅自补画、延续动作或复制主体。有效格共同形成连续的起承转合，但每格只表达一个动作和一个卖点。相邻格保持人物与商品身份、服装、环境方向、光线方向和色彩基调连续；使用远景、中景、近景、特写及合理机位变化建立镜头层次，避免九格构图重复。动作展示过程而非僵硬终态，并带有自然的手指、衣摆、发丝和重心细节。

【逐格内容】
${cells.join("\n\n")}

【强制质量检查】
输出前逐格检查：商品与参考图一致；人物身份一致；主体完整且位于单格内部；焦点清晰；手指和肢体结构正常；光线方向合理；物体有真实支撑和接触阴影；有效格之间有叙事变化而非复制。

【负面约束】
禁止低清晰度、模糊、失焦、像素化、压缩噪点、过曝、死黑、平光、塑料皮肤、蜡像脸、美颜滤镜、卡通感、错误解剖、多余手指、残缺手掌、重复人物、重复商品、商品变形、包装文字乱码、Logo 错误、悬浮物体、穿模、不合理遮挡、背景完全静止、九格构图重复。除商品参考图固有包装印刷外，画面内禁止标题、编号、字幕、口播文字、说明文字、水印、平台 UI、按钮、边框装饰和新增可读字符。`;
}

export function buildSingleShotImagePrompt(input: {
  shot: ScriptRemixNextShot;
  productName: string;
  portraitName?: string;
}) {
  return `【任务】
生成一张可直接用于 Seedance 2.0 的 9:16 竖版写实电商短视频分镜定帧。只生成一张完整画面，不要九宫格、拼贴或格中格。

【参考图优先级】
严格还原商品“${input.productName}”的几何轮廓、比例、颜色、包装结构、Logo 与印刷位置、材质纹理和关键细节，不得重新设计或生成近似替代品。${input.portraitName ? `严格保持人物“${input.portraitName}”的脸、发型、服装和体型。` : "如有人物，保持与参考图一致。"}

【画面内容】
${scriptRemixNextCompletePrompt(input.shot)}

【摄影与真实感】
真实摄影而非插画；主体清晰对焦，主光方向明确，曝光和白平衡准确，前景轻微虚化、中景主体锐利、背景有自然景深。保留自然皮肤纹理、衣物褶皱、商品材质高光与接触阴影；手、人物和商品遵守重力、支撑、遮挡及真实物理交互。动作呈现自然过程，避免僵硬摆拍。

【负面约束】
禁止模糊、失焦、低清晰度、过曝、平光、塑料皮肤、蜡像脸、美颜滤镜、卡通感、错误解剖、多余手指、重复主体、商品变形、包装文字乱码、Logo 错误、悬浮、穿模和不合理遮挡。除商品参考图固有包装印刷外，禁止标题、编号、字幕、口播文字、水印、平台 UI、按钮和新增可读字符。`;
}
