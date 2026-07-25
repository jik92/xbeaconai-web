import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

export const qwenTtsDialects = [
  "普通话",
  "广东话",
  "重庆话",
  "东北话",
  "甘肃话",
  "贵州话",
  "浙江话",
  "河北话",
  "河南话",
  "湖北话",
  "湖南话",
  "江西话",
  "宁波话",
  "宁夏话",
  "青岛话",
  "陕西话",
  "山西话",
  "山东话",
  "上海话",
  "四川话",
  "云南话",
] as const;

export const qwenTtsStyles = ["标准播音风格", "广告配音风格", "情绪递进风格", "温柔治愈风格"] as const;
export const qwenTtsModels = ["qwen-audio-3.0-tts-plus", "qwen-audio-3.0-tts-flash"] as const;
export const qwenTtsVoices = ["longanlingxin", "longanlufeng", "longanhuan_v3.6"] as const;

export type QwenTtsDialect = (typeof qwenTtsDialects)[number];
export type QwenTtsStyle = (typeof qwenTtsStyles)[number];
export type QwenTtsModel = (typeof qwenTtsModels)[number];
export type QwenTtsVoice = (typeof qwenTtsVoices)[number];

export interface QwenTtsOptions {
  dialect: QwenTtsDialect;
  style: QwenTtsStyle;
  text: string;
  model: QwenTtsModel;
  voice: QwenTtsVoice;
  seed: number;
  output?: string;
  csv: string;
  samples: boolean;
}

export interface QwenTtsInput {
  dialect: QwenTtsDialect;
  style: QwenTtsStyle;
  text: string;
  model: QwenTtsModel;
  voice: QwenTtsVoice;
  seed: number;
}

export const qwenTtsSampleCases: readonly QwenTtsInput[] = [
  {
    dialect: "广东话",
    style: "广告配音风格",
    text: "恭喜发财，天天向上！这份好彩头，送给每一个努力生活的你。",
    model: "qwen-audio-3.0-tts-plus",
    voice: "longanlingxin",
    seed: 101,
  },
  {
    dialect: "四川话",
    style: "广告配音风格",
    text: "这个味道巴适得很，今天下单还有惊喜，喜欢就莫要错过！",
    model: "qwen-audio-3.0-tts-plus",
    voice: "longanlingxin",
    seed: 102,
  },
  {
    dialect: "东北话",
    style: "情绪递进风格",
    text: "刚开始我还没当回事，后来越看越惊喜，这回可真是选对了！",
    model: "qwen-audio-3.0-tts-plus",
    voice: "longanlufeng",
    seed: 103,
  },
  {
    dialect: "上海话",
    style: "温柔治愈风格",
    text: "忙了一整天，侬也辛苦了，慢慢歇一歇，明天会更好。",
    model: "qwen-audio-3.0-tts-plus",
    voice: "longanlingxin",
    seed: 104,
  },
  {
    dialect: "河南话",
    style: "标准播音风格",
    text: "今天阳光正好，愿大家心里有希望，脚下有力量。",
    model: "qwen-audio-3.0-tts-plus",
    voice: "longanlufeng",
    seed: 105,
  },
  {
    dialect: "湖南话",
    style: "广告配音风格",
    text: "恭喜发财，天天向上！好东西要分享，好日子一起过。",
    model: "qwen-audio-3.0-tts-plus",
    voice: "longanlingxin",
    seed: 106,
  },
  {
    dialect: "重庆话",
    style: "广告配音风格",
    text: "恭喜发财，天天向上！这个好安逸，喜欢就不要错过。",
    model: "qwen-audio-3.0-tts-plus",
    voice: "longanlingxin",
    seed: 107,
  },
  {
    dialect: "普通话",
    style: "标准播音风格",
    text: "恭喜发财，天天向上。愿新的一天充满信心与力量。",
    model: "qwen-audio-3.0-tts-plus",
    voice: "longanlufeng",
    seed: 108,
  },
] as const;

const styleInstructions: Record<QwenTtsStyle, string> = {
  标准播音风格: "吐字清晰精准，节奏平稳，语气自然端正，不要过度夸张。",
  广告配音风格: "使用有感染力的广告配音表达，热情明快，重点词适度加强，保持自然可信。",
  情绪递进风格: "情绪从自然平稳逐步增强到兴奋有感染力，转折自然，不要突然喊叫。",
  温柔治愈风格: "使用温柔、亲切、治愈的表达，语速稍慢，停顿自然，保持轻松舒适。",
};

function valueAfter(args: string[], index: number, option: string) {
  const value = args[index + 1]?.trim();
  if (!value || value.startsWith("--")) throw new Error(`${option} 缺少参数值`);
  return value;
}

function catalogValue<const T extends readonly string[]>(catalog: T, value: string, message: string): T[number] {
  if (!catalog.includes(value)) throw new Error(`${message}：${value}`);
  return value as T[number];
}

export function parseQwenTtsArgs(args: string[]): QwenTtsOptions {
  const options: QwenTtsOptions = {
    dialect: "普通话",
    style: "标准播音风格",
    text: "恭喜发财，天天向上！",
    model: "qwen-audio-3.0-tts-plus",
    voice: "longanlingxin",
    seed: 0,
    csv: join(homedir(), "Desktop", "默认业务空间-apiKey-6310433.csv"),
    samples: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--samples") options.samples = true;
    else if (option === "--dialect")
      options.dialect = catalogValue(qwenTtsDialects, valueAfter(args, index++, option), "不支持的方言");
    else if (option === "--style")
      options.style = catalogValue(qwenTtsStyles, valueAfter(args, index++, option), "不支持的配音风格");
    else if (option === "--model")
      options.model = catalogValue(qwenTtsModels, valueAfter(args, index++, option), "不支持的模型");
    else if (option === "--voice")
      options.voice = catalogValue(qwenTtsVoices, valueAfter(args, index++, option), "不支持的音色");
    else if (option === "--text") options.text = valueAfter(args, index++, option);
    else if (option === "--output") options.output = valueAfter(args, index++, option);
    else if (option === "--csv") options.csv = valueAfter(args, index++, option);
    else if (option === "--seed") {
      const seed = Number(valueAfter(args, index++, option));
      if (!Number.isInteger(seed) || seed < 0 || seed > 65_535) throw new Error("seed 必须是 0–65535 的整数");
      options.seed = seed;
    } else if (option === "--help") {
      printHelp();
      process.exit(0);
    } else throw new Error(`未知参数：${option}`);
  }
  if (!options.text.trim() || options.text.length > 4_096) throw new Error("text 必须是 1–4096 个字符");
  if (options.model === "qwen-audio-3.0-tts-plus" && options.voice === "longanhuan_v3.6")
    throw new Error("longanhuan_v3.6 仅支持 qwen-audio-3.0-tts-flash");
  if (options.model === "qwen-audio-3.0-tts-flash" && ["longanlingxin", "longanlufeng"].includes(options.voice))
    throw new Error("longanlingxin 和 longanlufeng 仅支持 qwen-audio-3.0-tts-plus");
  return options;
}

export function buildQwenTtsInstruction(dialect: QwenTtsDialect, style: QwenTtsStyle) {
  const dialectInstruction =
    dialect === "普通话" ? "请用自然标准的普通话表达。" : `请用自然地道的${dialect}表达，不要使用普通话播音腔。`;
  return `${dialectInstruction}${styleInstructions[style]}`;
}

export function buildQwenTtsRequest(input: QwenTtsInput) {
  return {
    model: input.model,
    input: {
      text: input.text,
      voice: input.voice,
      format: "wav",
      sample_rate: 24_000,
      seed: input.seed,
      language_hints: ["zh"],
      instruction: buildQwenTtsInstruction(input.dialect, input.style),
    },
  };
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else value += character;
  }
  values.push(value);
  return values;
}

async function readWorkspaceCredentials(path: string) {
  const contents = await Bun.file(path).text();
  const entries = contents
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/)
    .map(parseCsvLine)
    .map(([key, value]) => [key, value?.trim()] as const);
  const values = Object.fromEntries(entries) as Record<string, string | undefined>;
  if (!values.apiKey || !values.workspaceId) throw new Error(`${basename(path)} 缺少 apiKey 或 workspaceId`);
  return { apiKey: values.apiKey, workspaceId: values.workspaceId };
}

type QwenTtsResponse = {
  request_id?: string;
  output?: { audio?: { url?: string } };
  usage?: { characters?: number };
  code?: string;
  message?: string;
};

async function downloadAudio(url: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength < 256) throw new Error("音频内容为空或无效");
      return bytes;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await Bun.sleep(500 * (attempt + 1));
    }
  }
  throw lastError;
}

async function synthesize(input: QwenTtsInput, csv: string, output: string) {
  const credentials = await readWorkspaceCredentials(csv);
  const endpoint = `https://${credentials.workspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildQwenTtsRequest(input)),
    signal: AbortSignal.timeout(180_000),
  });
  const payload = (await response.json()) as QwenTtsResponse;
  if (!response.ok)
    throw new Error(
      `Qwen TTS HTTP ${response.status}: ${payload.code ?? "UNKNOWN"} ${payload.message ?? "请求失败"} (${payload.request_id ?? "无请求 ID"})`,
    );
  const audioUrl = payload.output?.audio?.url;
  if (!audioUrl) throw new Error(`Qwen TTS 未返回音频地址 (${payload.request_id ?? "无请求 ID"})`);
  const bytes = await downloadAudio(audioUrl);
  await mkdir(dirname(output), { recursive: true });
  await Bun.write(output, bytes);
  return { output, bytes: bytes.byteLength, requestId: payload.request_id, characters: payload.usage?.characters };
}

function safeName(value: string) {
  return value.replace(/[<>:"/\\|?*]/g, "-");
}

function printHelp() {
  console.log(`Qwen 官方方言 TTS

单条：
  bun scripts/qwen-official-tts.ts --dialect 广东话 --style 广告配音风格 --text "恭喜发财"

批量试听：
  bun scripts/qwen-official-tts.ts --samples

参数：
  --dialect  ${qwenTtsDialects.join("、")}
  --style    ${qwenTtsStyles.join("、")}
  --model    ${qwenTtsModels.join("、")}
  --voice    ${qwenTtsVoices.join("、")}
  --text     合成文本
  --seed     0–65535
  --output   单条模式输出 WAV 路径
  --csv      业务空间 API Key CSV 路径
`);
}

async function main() {
  const options = parseQwenTtsArgs(Bun.argv.slice(2));
  if (options.samples) {
    const outputDirectory = options.output ?? join(homedir(), "Desktop", "qwen方言试听");
    for (const [index, sample] of qwenTtsSampleCases.entries()) {
      const output = join(
        outputDirectory,
        `${String(index + 1).padStart(2, "0")}-${safeName(sample.dialect)}-${safeName(sample.style)}-${sample.voice}.wav`,
      );
      const result = await synthesize(sample, options.csv, output);
      console.log(`[${index + 1}/${qwenTtsSampleCases.length}] 已生成：${result.output}`);
    }
    return;
  }
  const output =
    options.output ??
    join(homedir(), "Desktop", `qwen-${safeName(options.dialect)}-${safeName(options.style)}-${options.voice}.wav`);
  const result = await synthesize(options, options.csv, output);
  console.log(`已生成：${result.output}`);
}

if (import.meta.main) await main();
