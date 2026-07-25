import { describe, expect, test } from "bun:test";
import { AihubmixClient } from "../../server/providers/aihubmix";

describe("AIHubMix image API", () => {
  test("sends a single paid JSON generation request and normalizes every image", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new AihubmixClient("https://aihubmix.example.test", "test-key", async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json({
        data: [
          { b64_json: "aW1hZ2Ux", revised_prompt: "revised one" },
          { url: "https://cdn.example.test/image-2.png" },
        ],
      });
    });

    const result = await client.generateImages({
      prompt: "white studio",
      model: "gpt-image-1-mini",
      size: "1024x1024",
      count: 2,
      quality: "low",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://aihubmix.example.test/v1/images/generations");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      model: "gpt-image-1-mini",
      prompt: "white studio",
      n: 2,
      size: "1024x1024",
      quality: "low",
    });
    expect(result).toEqual([
      { b64Json: "aW1hZ2Ux", revisedPrompt: "revised one" },
      { url: "https://cdn.example.test/image-2.png" },
    ]);
  });

  test("sends every reference image through the multipart edit endpoint", async () => {
    let capturedBody: FormData | undefined;
    const client = new AihubmixClient("https://aihubmix.example.test", "test-key", async (_url, init) => {
      capturedBody = init?.body as FormData;
      return Response.json({ data: [{ b64_json: "ZWRpdGVk" }] });
    });

    await client.editImages({
      prompt: "keep the product, replace the background",
      model: "gpt-image-1-mini",
      size: "1024x1024",
      count: 1,
      quality: "low",
      images: [
        { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png", name: "front.png" },
        { bytes: new Uint8Array([4, 5, 6]), mimeType: "image/jpeg", name: "side.jpg" },
      ],
    });

    expect(capturedBody?.get("model")).toBe("gpt-image-1-mini");
    expect(capturedBody?.get("prompt")).toBe("keep the product, replace the background");
    expect(capturedBody?.get("size")).toBe("1024x1024");
    expect(capturedBody?.get("n")).toBe("1");
    expect(capturedBody?.getAll("image[]")).toHaveLength(2);
  });

  test("rejects an empty image response instead of creating an empty artifact", async () => {
    const client = new AihubmixClient("https://aihubmix.example.test", "test-key", async () =>
      Response.json({ data: [] }),
    );

    await expect(
      client.generateImages({
        prompt: "white studio",
        model: "gpt-image-1-mini",
        size: "1024x1024",
        count: 1,
      }),
    ).rejects.toThrow("AIHUBMIX_INVALID_IMAGE_RESULT");
  });

  test("submits Seedream multi-reference images to the exact Predictions model path", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new AihubmixClient("https://aihubmix.example.test", "test-key", async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json({
        output: ["https://cdn.example.test/seedream-1.png", "https://cdn.example.test/seedream-2.png"],
      });
    });

    const result = await client.generateSeedreamImages({
      prompt: "replace the coat",
      model: "doubao-seedream-4-5",
      size: "2K",
      count: 2,
      imageUrls: ["https://signed.example/front.png", "https://signed.example/coat.png"],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://aihubmix.example.test/v1/models/doubao/doubao-seedream-4-5/predictions",
    );
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      input: {
        model: "doubao-seedream-4-5",
        prompt: "replace the coat",
        image: ["https://signed.example/front.png", "https://signed.example/coat.png"],
        size: "2K",
        sequential_image_generation: "auto",
        sequential_image_generation_options: { max_images: 2 },
        stream: false,
        response_format: "url",
        watermark: false,
      },
    });
    expect(result).toEqual([
      { url: "https://cdn.example.test/seedream-1.png" },
      { url: "https://cdn.example.test/seedream-2.png" },
    ]);
  });

  test("normalizes an OpenAI-shaped Seedream response and rejects unfinished predictions", async () => {
    const completed = new AihubmixClient("https://aihubmix.example.test", "test-key", async () =>
      Response.json({ data: [{ url: "https://cdn.example.test/final.png" }] }),
    );
    expect(
      await completed.generateSeedreamImages({
        prompt: "studio",
        model: "doubao-seedream-4-0",
        size: "1K",
        count: 1,
        imageUrls: [],
      }),
    ).toEqual([{ url: "https://cdn.example.test/final.png" }]);

    const unfinished = new AihubmixClient("https://aihubmix.example.test", "test-key", async () =>
      Response.json({ id: "prediction-1", status: "processing" }),
    );
    await expect(
      unfinished.generateSeedreamImages({
        prompt: "studio",
        model: "doubao-seedream-4-0",
        size: "1K",
        count: 1,
        imageUrls: [],
      }),
    ).rejects.toThrow("AIHUBMIX_IMAGE_PREDICTION_NOT_COMPLETED");
  });

  test("generates Nano Banana 2 through Gemini Interactions with lowercase modalities", async () => {
    const calls: unknown[] = [];
    const client = new AihubmixClient("https://aihubmix.example.test", "test-key", fetch, () => ({
      interactions: {
        async create(input: unknown) {
          calls.push(input);
          return { output_image: { data: "bmFuby1iYW5hbmEtMg==", mime_type: "image/png" } };
        },
      },
      models: {
        async generateContent() {
          throw new Error("wrong Gemini protocol");
        },
      },
    }));

    const result = await client.generateGeminiInteractionImages({
      prompt: "a translucent banana lamp",
      model: "gemini-3.1-flash-image",
      aspectRatio: "1:1",
      imageSize: "1K",
      images: [],
    });

    expect(calls).toEqual([
      {
        model: "gemini-3.1-flash-image",
        input: "a translucent banana lamp",
        response_modalities: ["text", "image"],
        response_format: { type: "image", aspect_ratio: "1:1", image_size: "1K" },
      },
    ]);
    expect(result).toEqual([{ b64Json: "bmFuby1iYW5hbmEtMg==", mimeType: "image/png" }]);
  });

  test("generates Nano Banana Pro with inline references through non-streaming Gemini content", async () => {
    const calls: unknown[] = [];
    const client = new AihubmixClient("https://aihubmix.example.test", "test-key", fetch, () => ({
      interactions: {
        async create() {
          throw new Error("wrong Gemini protocol");
        },
      },
      models: {
        async generateContent(input: unknown) {
          calls.push(input);
          return {
            candidates: [
              {
                content: {
                  parts: [
                    { text: "done" },
                    { inlineData: { data: "cHJvLWltYWdl", mimeType: "image/webp" } },
                  ],
                },
              },
            ],
          };
        },
      },
    }));

    const result = await client.generateGeminiContentImages({
      prompt: "put the product in a studio",
      model: "gemini-3-pro-image-preview",
      aspectRatio: "16:9",
      imageSize: "2K",
      images: [{ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png", name: "product.png" }],
    });

    expect(calls).toEqual([
      {
        model: "gemini-3-pro-image-preview",
        contents: [
          {
            role: "user",
            parts: [
              { text: "put the product in a studio" },
              { inlineData: { data: "AQID", mimeType: "image/png" } },
            ],
          },
        ],
        config: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: { aspectRatio: "16:9", imageSize: "2K" },
        },
      },
    ]);
    expect(result).toEqual([{ b64Json: "cHJvLWltYWdl", mimeType: "image/webp" }]);
  });

  test("rejects Gemini image requests over the inline media limit and empty responses", async () => {
    const client = new AihubmixClient("https://aihubmix.example.test", "test-key", fetch, () => ({
      interactions: {
        async create() {
          return {};
        },
      },
      models: {
        async generateContent() {
          return { candidates: [] };
        },
      },
    }));

    await expect(
      client.generateGeminiContentImages({
        prompt: "too large",
        model: "gemini-3-pro-image-preview",
        aspectRatio: "1:1",
        imageSize: "1K",
        images: [
          {
            bytes: new Uint8Array(20 * 1024 * 1024 + 1),
            mimeType: "image/png",
            name: "large.png",
          },
        ],
      }),
    ).rejects.toThrow("AIHUBMIX_GEMINI_INLINE_LIMIT_EXCEEDED");
    await expect(
      client.generateGeminiInteractionImages({
        prompt: "empty",
        model: "gemini-3.1-flash-image",
        aspectRatio: "1:1",
        imageSize: "1K",
        images: [],
      }),
    ).rejects.toThrow("AIHUBMIX_INVALID_IMAGE_RESULT");
  });
});
