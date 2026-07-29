import { providerCredentials } from "../byok/credential-store";
import { env } from "../env";
import { ARK_API_BASE_URL } from "./ark-seedance";

export async function generateArkText(
  prompt: string,
  model: string,
  options: { maxTokens: number; temperature: number; json: boolean; timeoutMs: number },
) {
  const apiKey = providerCredentials.get("ARK_API_KEY") ?? "";
  if (!apiKey) throw new Error("ARK_NOT_CONFIGURED");
  if (env.blockAiOutbound) throw new Error("AI_OUTBOUND_BLOCKED:ark-text");
  const response = await fetch(`${ARK_API_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      ...(options.json ? { response_format: { type: "json_object" } } : {}),
      thinking: { type: "disabled" },
    }),
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`ARK_${response.status}: ${raw.slice(0, 1_000)}`);
  const body = JSON.parse(raw) as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
    usage?: unknown;
  };
  const text = body.choices?.[0]?.message?.content;
  if (!text) throw new Error("ARK_INVALID_TEXT_RESULT");
  return { text, model: body.model ?? model, usage: body.usage };
}
