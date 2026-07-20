import { env } from "../env";

interface GeminiGenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  modelVersion?: string;
}

export interface VideoAnalysisResult {
  text: string;
  model: string;
  usage?: GeminiGenerateContentResponse["usageMetadata"];
}

export async function analyzeImagesWithGemini(input: {
  images: Array<{ path: string; mimeType: string }>;
  prompt: string;
  model?: string;
}): Promise<VideoAnalysisResult> {
  if (!env.openaiKey) throw new Error("AIHUBMIX_NOT_CONFIGURED");
  if (env.blockAiOutbound) throw new Error("AI_OUTBOUND_BLOCKED:image-analysis");
  if (!input.images.length) throw new Error("IMAGE_ANALYSIS_REQUIRES_IMAGE");
  const model = input.model ?? env.videoAnalysisModel;
  const files = await Promise.all(
    input.images.map(async (image) => {
      const file = Bun.file(image.path);
      if (!(await file.exists())) throw new Error("PRODUCT_REFERENCE_FILE_NOT_FOUND");
      return { file, mimeType: image.mimeType };
    }),
  );
  if (files.reduce((total, item) => total + item.file.size, 0) > 20 * 1024 * 1024)
    throw new Error("IMAGE_ANALYSIS_INLINE_LIMIT_EXCEEDED");
  const parts = await Promise.all(
    files.map(async (item) => ({
      inlineData: {
        mimeType: item.mimeType,
        data: Buffer.from(await item.file.arrayBuffer()).toString("base64"),
      },
    })),
  );
  const origin = new URL(env.openaiBaseUrl || "https://aihubmix.com").origin;
  const response = await fetch(`${origin}/gemini/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": env.openaiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [...parts, { text: input.prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 4_096, responseMimeType: "application/json" },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`GEMINI_IMAGE_ANALYSIS_${response.status}: ${raw.slice(0, 1_000)}`);
  const body = JSON.parse(raw) as GeminiGenerateContentResponse;
  const text = body.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!text) throw new Error(`GEMINI_IMAGE_ANALYSIS_EMPTY:${body.candidates?.[0]?.finishReason ?? "unknown"}`);
  return { text, model: body.modelVersion ?? model, usage: body.usageMetadata };
}

export async function transcribeMediaWithAihubmix(input: { mediaPath: string; mimeType?: string; model?: string }) {
  if (!env.openaiKey) throw new Error("AIHUBMIX_NOT_CONFIGURED");
  if (env.blockAiOutbound) throw new Error("AI_OUTBOUND_BLOCKED:transcription");
  const file = Bun.file(input.mediaPath);
  if (!(await file.exists())) throw new Error("TRANSCRIPTION_FILE_NOT_FOUND");
  const form = new FormData();
  const mimeType = input.mimeType ?? "video/mp4";
  const filename = mimeType === "audio/wav" ? "source.wav" : mimeType === "audio/mpeg" ? "source.mp3" : "source.mp4";
  form.set("file", new File([file], filename, { type: mimeType }));
  form.set("model", input.model ?? "gpt-4o-transcribe-diarize");
  form.set("language", "zh");
  form.set("response_format", "json");
  const response = await fetch(new URL("/v1/audio/transcriptions", env.openaiBaseUrl || "https://aihubmix.com"), {
    method: "POST",
    headers: { Authorization: `Bearer ${env.openaiKey}` },
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`AIHUBMIX_TRANSCRIPTION_${response.status}: ${raw.slice(0, 1_000)}`);
  const body = JSON.parse(raw) as { text?: string; usage?: unknown };
  if (!body.text?.trim()) throw new Error("AIHUBMIX_TRANSCRIPTION_EMPTY");
  return { text: body.text.trim(), usage: body.usage };
}

export async function analyzeVideoWithGemini(input: {
  videoPath: string;
  prompt: string;
  mimeType?: string;
  model?: string;
  productImages?: Array<{ path: string; mimeType: string }>;
}): Promise<VideoAnalysisResult> {
  if (!env.openaiKey) throw new Error("AIHUBMIX_NOT_CONFIGURED");
  if (env.blockAiOutbound) throw new Error("AI_OUTBOUND_BLOCKED:video-analysis");
  const model = input.model ?? "gemini-3.1-pro-preview";
  const file = Bun.file(input.videoPath);
  if (!(await file.exists())) throw new Error("VIDEO_ANALYSIS_FILE_NOT_FOUND");
  const referenceFiles = await Promise.all(
    (input.productImages ?? []).map(async (image) => {
      const reference = Bun.file(image.path);
      if (!(await reference.exists())) throw new Error("PRODUCT_REFERENCE_FILE_NOT_FOUND");
      return { file: reference, mimeType: image.mimeType };
    }),
  );
  const totalBytes = file.size + referenceFiles.reduce((total, reference) => total + reference.file.size, 0);
  if (totalBytes > 20 * 1024 * 1024) throw new Error("VIDEO_ANALYSIS_INLINE_LIMIT_EXCEEDED");
  const parts = [
    {
      inlineData: {
        mimeType: input.mimeType ?? "video/mp4",
        data: Buffer.from(await file.arrayBuffer()).toString("base64"),
      },
    },
  ];
  for (const reference of referenceFiles) {
    parts.push({
      inlineData: {
        mimeType: reference.mimeType,
        data: Buffer.from(await reference.file.arrayBuffer()).toString("base64"),
      },
    });
  }
  const baseUrl = env.openaiBaseUrl || "https://aihubmix.com";
  const origin = new URL(baseUrl).origin;
  const response = await fetch(`${origin}/gemini/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": env.openaiKey },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [...parts, { text: input.prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8_192,
        responseMimeType: "text/plain",
      },
    }),
    signal: AbortSignal.timeout(240_000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`GEMINI_VIDEO_ANALYSIS_${response.status}: ${raw.slice(0, 1_000)}`);
  const body = JSON.parse(raw) as GeminiGenerateContentResponse;
  const text = body.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!text) throw new Error(`GEMINI_VIDEO_ANALYSIS_EMPTY:${body.candidates?.[0]?.finishReason ?? "unknown"}`);
  return { text, model: body.modelVersion ?? model, usage: body.usageMetadata };
}
