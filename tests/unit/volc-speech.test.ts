import { describe, expect, test } from "bun:test";
import { VolcSpeechError, VolcSpeechProvider } from "../../server/providers/volc-speech";

const config = {
  apiKeyId: "key-record-id",
  apiKey: "test-secret",
  baseUrl: "https://speech.example.test",
  cloneResourceId: "seed-icl-2.0",
  ttsResourceId: "seed-icl-2.0",
  presetTtsResourceId: "seed-tts-2.0",
  pollIntervalMs: 1,
  pollTimeoutMs: 100,
};

describe("VolcSpeechProvider", () => {
  test("uses V3 API-key authentication and maps the training request", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const provider = new VolcSpeechProvider(config, async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return Response.json({ code: 0, message: "OK", status: 2, demo_audio: "UklGRg==" });
    });

    const response = await provider.train({
      speaker: { speaker_id: "custom_speaker_id", custom_speaker_id: "custom_zh_test" },
      bytes: new Uint8Array([1, 2, 3]),
      format: "wav",
      transcript: "测试录音",
      language: 0,
      demoText: "你好，这是试听文本。",
      enableDenoise: true,
    });

    expect(capturedUrl).toBe("https://speech.example.test/api/v3/tts/voice_clone");
    expect(new Headers(capturedInit?.headers).get("X-Api-Key")).toBe("test-secret");
    expect(JSON.parse(String(capturedInit?.body))).toMatchObject({
      speaker_id: "custom_speaker_id",
      custom_speaker_id: "custom_zh_test",
      audio: { data: "AQID", format: "wav" },
      extra_params: { demo_text: "你好，这是试听文本。", enable_audio_denoise: true },
    });
    expect(response.status).toBe(2);
  });

  test("polls the status endpoint until a voice is ready", async () => {
    let calls = 0;
    const provider = new VolcSpeechProvider(config, async () => {
      calls += 1;
      return Response.json({ code: 0, message: "OK", status: calls === 1 ? 1 : 2, demo_audio: "UklGRg==" });
    });
    const speaker = { speaker_id: "speaker-test" };
    const initial = await provider.query(speaker);
    const ready = await provider.waitUntilReady(speaker, initial, () => false);

    expect(calls).toBe(2);
    expect(ready.status).toBe(2);
  });

  test("accepts the current success payload and reads preview audio from speaker_status", async () => {
    const provider = new VolcSpeechProvider(config, async () =>
      Response.json({
        status: 2,
        speaker_id: "S_test",
        speaker_status: [{ model_type: 5, demo_audio: "https://speech.example.test/demo.mp3" }],
      }),
    );
    const status = await provider.query({ speaker_id: "S_test" });

    expect(provider.resultAudio(status)).toEqual({
      demoAudio: "https://speech.example.test/demo.mp3",
      modelType: 5,
    });
  });

  test("surfaces upstream authentication failures without exposing credentials", async () => {
    const provider = new VolcSpeechProvider(config, async () =>
      Response.json({ code: 45000010, message: "Invalid X-Api-Key" }, { status: 401 }),
    );
    const error = await provider.query({ speaker_id: "speaker-test" }).catch((caught) => caught);

    expect(error).toBeInstanceOf(VolcSpeechError);
    expect(error).toMatchObject({ code: "VOLC_SPEECH_45000010", retryable: false });
    expect(String(error)).not.toContain(config.apiKey);
  });

  test("does not mark resource configuration failures as retryable even when upstream uses HTTP 500", async () => {
    const provider = new VolcSpeechProvider(config, async () =>
      Response.json(
        { code: 55000000, message: "resource ID is mismatched with speaker related resource" },
        { status: 500 },
      ),
    );
    const error = await provider.query({ speaker_id: "speaker-test" }).catch((caught) => caught);

    expect(error).toMatchObject({ code: "VOLC_SPEECH_55000000", retryable: false });
  });

  test("maps synthesis parameters and joins NDJSON audio chunks", async () => {
    let capturedInit: RequestInit | undefined;
    const provider = new VolcSpeechProvider(config, async (_input, init) => {
      capturedInit = init;
      return new Response(
        [
          JSON.stringify({ reqid: "req-test", code: 0, data: Buffer.from([1, 2]).toString("base64") }),
          JSON.stringify({ reqid: "req-test", code: 0, data: Buffer.from([3, 4]).toString("base64") }),
          JSON.stringify({ reqid: "req-test", code: 20_000_000, message: "OK" }),
        ].join("\n"),
        { headers: { "X-Tt-Logid": "log-test" } },
      );
    });

    const result = await provider.synthesize({
      requestId: "req-test",
      resourceId: "seed-tts-2.0",
      speaker: "zh_female_vv_uranus_bigtts",
      text: "这是一段测试语音。",
      model: "seed-tts-2.0-expressive",
      speechRate: 10,
      explicitLanguage: "zh",
      contextText: "用温暖、自然的语气讲述。",
      toneFidelity: false,
    });

    expect([...result.bytes]).toEqual([1, 2, 3, 4]);
    expect(result.logId).toBe("log-test");
    expect(new Headers(capturedInit?.headers).get("X-Api-Resource-Id")).toBe("seed-tts-2.0");
    const body = JSON.parse(String(capturedInit?.body));
    expect(body.req_params).toMatchObject({
      speaker: "zh_female_vv_uranus_bigtts",
      model: "seed-tts-2.0-expressive",
      audio_params: { format: "mp3", sample_rate: 24_000, speech_rate: 10 },
    });
    expect(JSON.parse(body.req_params.additions)).toMatchObject({
      explicit_language: "zh",
      context_texts: ["用温暖、自然的语气讲述。"],
      tone_fidelity: false,
    });
  });

  test("maps synthesis business errors without treating invalid input as retryable", async () => {
    const provider = new VolcSpeechProvider(
      config,
      async () => new Response(JSON.stringify({ code: 45_002_001, message: "No readable text!" })),
    );
    const error = await provider
      .synthesize({
        requestId: "req-test",
        resourceId: "seed-tts-2.0",
        speaker: "zh_female_vv_uranus_bigtts",
        text: "",
        model: "seed-tts-2.0-standard",
        speechRate: 0,
        toneFidelity: false,
      })
      .catch((caught) => caught);

    expect(error).toMatchObject({ code: "VOLC_SPEECH_45002001", retryable: false });
  });
});
