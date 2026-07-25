export type VideoCreateReferenceKind = "image" | "video" | "audio";
export type VideoCreateImageCategory = "人物" | "商品";

export interface VideoCreatePromptReference {
  label: string;
  name: string;
  role: "reference_image" | "reference_video" | "reference_audio";
  category?: VideoCreateImageCategory;
}

export interface VideoCreateSubshotPlan {
  action: string;
  narration: string;
  expression: string;
  voiceTone: string;
  durationSec: number;
  shotSize: string;
  composition: string;
  background: string;
  lighting: string;
}

export interface VideoCreateShotGenerationPlan {
  characterAppearance: string;
  cameraView: string;
  background: string;
  lighting: string;
  voice: string;
  quality: string;
  subshots: VideoCreateSubshotPlan[];
}

const globalConstraints =
  "人物动作自然流畅，面部无扭曲变形；场景真实有生活感，无多余杂物穿模；精准还原商品外观，禁止错误生成；仅精准还原参考图产品 LOGO 与原有印刷文字，禁止额外生成任何字幕、底部字幕、旁白字幕，不新增任何文字，杜绝双层字幕。";

const naturalExpression =
  "面部充满自然微表情，每 3-4 秒自然眨眼一次，眼球缓慢转动，目光柔和平视镜头，眼神有光不空洞；嘴角松弛柔和，面部肌肉放松不紧绷；杜绝面瘫脸、杜绝机械假脸，五官动态自然柔和；说话时眉眼轻微微动，神态生活化接地气，去掉 AI 虚拟质感，呈现真人真实鲜活神态，表情生动不死板。";

export function videoCreateReferenceKind(mimeType: string): VideoCreateReferenceKind | undefined {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return undefined;
}

export function videoCreateReferenceRole(kind: VideoCreateReferenceKind) {
  if (kind === "image") return "reference_image" as const;
  if (kind === "video") return "reference_video" as const;
  return "reference_audio" as const;
}

export function nextVideoCreateReferenceLabel(kind: VideoCreateReferenceKind, existing: string[]) {
  const prefix = kind === "image" ? "Image" : kind === "video" ? "Video" : "Audio";
  let ordinal = 1;
  while (existing.includes(`${prefix}${ordinal}`)) ordinal += 1;
  return `${prefix}${ordinal}`;
}

function textWeight(value: string) {
  return Math.max([...value.replace(/\s/gu, "")].length, 1);
}

export function splitVideoCreateSubshotText(value: string, count: number) {
  const targetCount = Math.max(1, Math.min(count, Math.max([...value.trim()].length, 1)));
  const matched =
    value
      .trim()
      .match(/[^，,。！？!?；;\n]+[，,。！？!?；;]?/gu)
      ?.filter(Boolean) ?? [];
  const parts = matched.length ? matched : [value.trim()];
  while (parts.length < targetCount) {
    const index = parts.reduce(
      (largest, part, current) => (textWeight(part) > textWeight(parts[largest] ?? "") ? current : largest),
      0,
    );
    const characters = [...(parts[index] ?? "")];
    if (characters.length < 2) break;
    const middle = Math.ceil(characters.length / 2);
    parts.splice(index, 1, characters.slice(0, middle).join(""), characters.slice(middle).join(""));
  }
  while (parts.length > targetCount) {
    let index = 0;
    for (let current = 1; current < parts.length - 1; current += 1) {
      if (textWeight(`${parts[current]}${parts[current + 1]}`) < textWeight(`${parts[index]}${parts[index + 1]}`))
        index = current;
    }
    parts.splice(index, 2, `${parts[index]}${parts[index + 1]}`);
  }
  return parts.map((part) => part.trim()).filter(Boolean);
}

export function allocateVideoCreateSubshotDurations(parts: string[], durationSec: number) {
  const safeDuration = Math.max(parts.length, Math.round(durationSec));
  const durations = parts.map(() => 1);
  let remaining = safeDuration - durations.length;
  const weights = parts.map(textWeight);
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  const fractions = weights.map((weight, index) => ({
    index,
    value: (remaining * weight) / totalWeight,
  }));
  for (const fraction of fractions) {
    const whole = Math.floor(fraction.value);
    durations[fraction.index] += whole;
    remaining -= whole;
  }
  fractions.sort((left, right) => (right.value % 1) - (left.value % 1));
  for (let index = 0; index < remaining; index += 1) durations[fractions[index % fractions.length].index] += 1;
  return durations;
}

function fallbackExpression(narration: string) {
  if (/[？?]/u.test(narration)) return "面露自然疑惑，眉眼轻微互动，语气带疑问感";
  if (/[！!]/u.test(narration)) return "表情雀跃有感染力，眉眼自然舒展";
  return "面带自然微笑，神态放松，目光柔和平视镜头";
}

function fallbackVoiceTone(narration: string) {
  if (/[？?]/u.test(narration)) return "自然亲切，带轻微疑问感";
  if (/[！!]/u.test(narration)) return "热切有感染力，带自然号召感";
  return "亲切自然，充满真实分享感";
}

export function createFallbackVideoCreateShotPlan(input: {
  durationSec: number;
  shotPrompt: string;
  narration: string;
}): VideoCreateShotGenerationPlan {
  const desiredCount = input.durationSec >= 10 ? 3 : 2;
  const narrations = splitVideoCreateSubshotText(input.narration, desiredCount);
  const actions = splitVideoCreateSubshotText(input.shotPrompt, narrations.length);
  const durations = allocateVideoCreateSubshotDurations(narrations, input.durationSec);
  return {
    characterAppearance: "人物形象与服饰保持前后一致，符合真实生活化商品展示场景",
    cameraView: "全片以平视视角为主，贴近日常短视频拍摄感",
    background: `遵循当前分镜的真实生活化场景设定：${input.shotPrompt.trim()}`,
    lighting: "自然柔和光线，光影通透，无生硬阴影",
    voice: "年轻自然的女生音色，语气亲切有种草感",
    quality: "4K高清，色彩明亮通透，画面清晰无噪点",
    subshots: narrations.map((narration, index) => ({
      action: actions[index] ?? actions.at(-1) ?? input.shotPrompt.trim(),
      narration,
      expression: fallbackExpression(narration),
      voiceTone: fallbackVoiceTone(narration),
      durationSec: durations[index],
      shotSize: index % 2 === 0 ? "近景" : "中景",
      composition: index % 2 === 0 ? "人物与商品位于画面视觉中心" : "人物自然展示，商品完整清晰露出",
      background: "延续全局背景环境，保持前后连续一致",
      lighting: "延续全局自然柔和光线",
    })),
  };
}

export function fitVideoCreateShotPlanDuration(
  plan: VideoCreateShotGenerationPlan,
  durationSec: number,
): VideoCreateShotGenerationPlan {
  const durations = allocateVideoCreateSubshotDurations(
    plan.subshots.map((subshot) => subshot.narration),
    durationSec,
  );
  return {
    ...plan,
    subshots: plan.subshots.map((subshot, index) => ({ ...subshot, durationSec: durations[index] })),
  };
}

function referenceToken(reference: VideoCreatePromptReference) {
  return `@${reference.label}${reference.category ? `（${reference.category}）` : ""}`;
}

const visualPersonDescriptorPattern =
  /(?:(?:\d{1,3}\s*岁(?:左右)?|年轻|青春靓丽|中年|年长|老年)的?\s*)?(?:女主播|男主播|女模特|男模特|小姐姐|小哥哥|女性|男性|女生|男生|女孩|男孩|女人|男人|女士|先生|模特)/gu;
const visualPersonPronounPattern =
  /(^|[，。；：、,\s]|随后|然后|接着|同时)(?:(?:\d{1,3}\s*岁(?:左右)?|年轻|青春靓丽|中年|年长|老年)的?\s*)?[她他](?=的|在|正|先|后|拿|对|将|把|用|面|侧|转|走|坐|站|做|展示|佩戴|穿|露|微|伸|看|注视|说|介绍|比|挥|点|$)/gu;

function neutralizeVisualPersonDescription(value: string) {
  return value
    .replace(visualPersonDescriptorPattern, "人物")
    .replace(visualPersonPronounPattern, (_match, prefix: string) => `${prefix}人物`);
}

function portraitBoundVisualDescription(value: string, hasPortraitReference: boolean) {
  return hasPortraitReference ? neutralizeVisualPersonDescription(value) : value;
}

export function buildVideoCreateShotGenerationPrompt(input: {
  durationSec: number;
  plan: VideoCreateShotGenerationPlan;
  references: VideoCreatePromptReference[];
}) {
  const people = input.references.filter((reference) => reference.category === "人物").map(referenceToken);
  const products = input.references.filter((reference) => reference.category === "商品").map(referenceToken);
  const audio = input.references.filter((reference) => reference.role === "reference_audio").map(referenceToken);
  const videos = input.references.filter((reference) => reference.role === "reference_video").map(referenceToken);
  const constraints = products.length
    ? `${globalConstraints} 商品外观严格参考 ${products.join("、")}。`
    : globalConstraints;
  const characterAppearance = people.length
    ? `人物主体必须使用 ${people.join("、")}；人物形象严格参考人物图片，保持其性别、年龄、脸型、五官、肤色、发型和身份特征一致，禁止替换为其他人物`
    : input.plan.characterAppearance;
  const voice = audio.length ? `${input.plan.voice}，音色严格参考 ${audio.join("、")}` : input.plan.voice;
  const hasPortraitReference = people.length > 0;
  const global = [
    "### 第一部分：全局基础设定",
    `约束条件：${constraints}`,
    `人物形象：${characterAppearance}`,
    `人物神态：${naturalExpression}`,
    `镜头视角：${portraitBoundVisualDescription(input.plan.cameraView, hasPortraitReference)}${videos.length ? `，镜头运动严格参考 ${videos.join("、")}` : ""}`,
    `背景描述：${portraitBoundVisualDescription(input.plan.background, hasPortraitReference)}`,
    `光线分析：${portraitBoundVisualDescription(input.plan.lighting, hasPortraitReference)}`,
    `音色设定：${voice}`,
    `画质要求：${input.plan.quality}`,
    `视频总时长：${input.durationSec}秒。`,
  ];
  const subshots = input.plan.subshots.map((subshot, index) =>
    [
      `分镜 ${String(index + 1).padStart(2, "0")}`,
      `人物动作描述：${portraitBoundVisualDescription(subshot.action, hasPortraitReference)}`,
      `画面口播文案：${subshot.narration}`,
      `人物说话神态：${portraitBoundVisualDescription(subshot.expression, hasPortraitReference)}`,
      `音色语气设定：${subshot.voiceTone}`,
      `分镜时长：${subshot.durationSec}秒`,
      `景别：${portraitBoundVisualDescription(subshot.shotSize, hasPortraitReference)}`,
      `画面构图：${portraitBoundVisualDescription(subshot.composition, hasPortraitReference)}`,
      `背景环境描述：${portraitBoundVisualDescription(subshot.background, hasPortraitReference)}`,
      `光线风格分析：${portraitBoundVisualDescription(subshot.lighting, hasPortraitReference)}`,
    ].join("\n"),
  );
  return [
    ...global,
    "",
    "### 第二部分：分镜内容（按播放顺序逐条输出分镜，每条独立成段，并标注序号）",
    ...subshots.flatMap((subshot) => [subshot, ""]),
  ]
    .join("\n")
    .trim();
}
