import { mkdir } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { env } from "../server/env";
import { probeMedia } from "../server/media/ffmpeg";
import { VolcSpeechError, volcSpeech } from "../server/providers/volc-speech";
import { isVoicePresetId } from "../shared/voice/preset-voices";
import { isVoicePresetStyle, voicePresetStyleInstruction } from "../shared/voice/preset-styles";

const command = process.argv[2] ?? "probe";
const args = new Map<string, string>();
for (let index = 3; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (!key.startsWith("--")) continue;
  const next = process.argv[index + 1];
  if (next && !next.startsWith("--")) {
    args.set(key, next);
    index += 1;
  } else {
    args.set(key, "true");
  }
}

const required = (name: string) => {
  const value = args.get(name)?.trim();
  if (!value) throw new Error(`缺少参数 ${name}`);
  return value;
};

const confirmation = (name: string, message: string) => {
  if (args.get(name) !== "true") throw new Error(message);
};

const outputDirectory = resolve("artifacts/api-tests/volc-speech");
await mkdir(outputDirectory, { recursive: true, mode: 0o700 });

async function probe() {
  const report: Record<string, unknown> = {
    testedAt: new Date().toISOString(),
    apiKeyConfigured: volcSpeech.configured,
    presetTts: "unknown",
    voiceClone: "unknown",
  };
  try {
    await volcSpeech.synthesize({
      requestId: crypto.randomUUID(),
      resourceId: env.volcSpeech.presetTtsResourceId,
      speaker: "zh_female_vv_uranus_bigtts",
      text: "",
      model: "seed-tts-2.0-standard",
      speechRate: 0,
      toneFidelity: false,
    });
    report.presetTts = "unexpected-audio";
  } catch (error) {
    report.presetTts =
      error instanceof VolcSpeechError && error.code === "VOLC_SPEECH_45002001"
        ? "available"
        : error instanceof VolcSpeechError
          ? { status: "unavailable", code: error.code, message: error.message }
          : { status: "unknown", message: error instanceof Error ? error.message : String(error) };
  }
  try {
    await volcSpeech.train({
      speaker: { speaker_id: "custom_speaker_id", custom_speaker_id: "probe_permission_only" },
      bytes: new Uint8Array(),
      format: "wav",
      transcript: "",
      language: 0,
      demoText: "权限探测不会上传真实录音。",
      enableDenoise: false,
    });
    report.voiceClone = "unexpected-training";
  } catch (error) {
    report.voiceClone =
      error instanceof VolcSpeechError
        ? {
            status: /NOT_GRANTED|45000030/.test(error.code) ? "not-granted" : "endpoint-reached",
            code: error.code,
            message: error.message,
          }
        : { status: "unknown", message: error instanceof Error ? error.message : String(error) };
  }
  console.log(JSON.stringify(report, null, 2));
}

async function train() {
  confirmation("--confirm-authorized", "训练前必须添加 --confirm-authorized，确认已获得声音主体授权");
  confirmation("--confirm-training", "训练会向供应商上传生物特征录音，必须添加 --confirm-training");
  const consentReference = required("--consent-reference");
  const audioPath = resolve(required("--audio"));
  const transcript = required("--transcript");
  const file = Bun.file(audioPath);
  if (!(await file.exists())) throw new Error("训练音频不存在");
  if (file.size > 10 * 1024 * 1024) throw new Error("训练音频不能超过 10MB");
  const media = await probeMedia(audioPath);
  const duration = Number(media.format.duration ?? 0);
  if (!Number.isFinite(duration) || duration < 5 || duration > 60) throw new Error("训练录音时长必须为 5–60 秒");
  const format = extname(audioPath).toLowerCase().slice(1);
  if (!new Set(["wav", "mp3", "ogg", "m4a", "aac", "pcm"]).has(format)) throw new Error("训练音频格式不受支持");
  const bytes = await file.bytes();
  const sampleSha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  const speaker = { speaker_id: "" };
  const initial = await volcSpeech.train({
    speaker,
    bytes,
    format,
    transcript,
    language: 0,
    demoText: args.get("--demo-text") ?? "你好，这是授权范围内的音色克隆试听。",
    enableDenoise: args.get("--enable-denoise") === "true",
  });
  const assignedSpeakerId = initial.speaker_id?.trim() ?? "";
  if (!assignedSpeakerId) throw new Error("训练接口未返回自动分配的音色标识");
  const querySpeaker = { speaker_id: assignedSpeakerId };
  const ready = await volcSpeech.waitUntilReady(querySpeaker, initial, () => false);
  const preview = volcSpeech.resultAudio(ready);
  const previewBytes = await volcSpeech.downloadDemo(preview.demoAudio);
  const outputPath = resolve(outputDirectory, `clone-${Date.now()}.mp3`);
  await Bun.write(outputPath, previewBytes);
  await probeMedia(outputPath);
  const metadataPath = `${outputPath}.json`;
  await Bun.write(
    metadataPath,
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        consentReference,
        speakerId: ready.speaker_id || assignedSpeakerId,
        sampleSha256,
        modelType: preview.modelType,
        availableTrainingTimes: ready.available_training_times,
        outputPath,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ status: "ready", outputPath, metadataPath, sampleSha256 }, null, 2));
}

async function synthesize() {
  confirmation("--confirm-billable-use", "正式合成可能产生费用，必须添加 --confirm-billable-use");
  const text = required("--text");
  const speaker = required("--speaker-id");
  const cloned = args.get("--cloned") === "true";
  if (!cloned && !isVoicePresetId(speaker))
    throw new Error("预置音色不在当前已验证目录中；克隆音色请同时添加 --cloned");
  if (cloned) {
    confirmation("--confirm-authorized", "使用克隆音色必须添加 --confirm-authorized");
    required("--consent-reference");
  }
  const speechRate = Number(args.get("--speech-rate") ?? 0);
  if (!Number.isInteger(speechRate) || speechRate < -50 || speechRate > 100)
    throw new Error("--speech-rate 范围为 -50 到 100");
  const style = args.get("--style") ?? "自然";
  if (!isVoicePresetStyle(style)) throw new Error("--style 仅支持：自然、纪录片、短视频、哄睡");
  const styleInstruction = voicePresetStyleInstruction(style);
  const requestId = crypto.randomUUID();
  const result = await volcSpeech.synthesize({
    requestId,
    resourceId: cloned ? env.volcSpeech.ttsResourceId : env.volcSpeech.presetTtsResourceId,
    speaker,
    text,
    model: styleInstruction ? "seed-tts-2.0-expressive" : "seed-tts-2.0-standard",
    speechRate,
    explicitLanguage: args.get("--language"),
    explicitDialect: args.get("--dialect"),
    contextText: styleInstruction,
    toneFidelity: cloned && args.get("--tone-fidelity") === "true",
  });
  const outputPath = resolve(outputDirectory, `synthesis-${Date.now()}.mp3`);
  await Bun.write(outputPath, result.bytes);
  const media = await probeMedia(outputPath);
  const outputSha256 = new Bun.CryptoHasher("sha256").update(result.bytes).digest("hex");
  console.log(
    JSON.stringify(
      {
        status: "succeeded",
        requestId,
        logId: result.logId,
        outputPath,
        outputSha256,
        duration: media.format.duration,
      },
      null,
      2,
    ),
  );
}

if (command === "probe") await probe();
else if (command === "train") await train();
else if (command === "synthesize") await synthesize();
else throw new Error("命令仅支持 probe、train 或 synthesize");
