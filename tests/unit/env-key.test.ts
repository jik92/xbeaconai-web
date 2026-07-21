import { describe, expect, test } from "bun:test";
import { parseEnvKey, removeProviderEnvironment, serializeEnvKey } from "../../server/byok/env-key";

describe(".env.key parser", () => {
  test("accepts supported assignments and reports empty and unknown fields", () => {
    const parsed = parseEnvKey(`
# provider credentials
OPENAI_KEY="openai-secret"
export VOLC_SPEECH_API_KEY='speech-secret'
MEDIAKIT_API_KEY=
JWT_SECRET=must-be-ignored
OPENAI_KEY=rotated-secret
`);
    expect(parsed.values).toEqual({ OPENAI_KEY: "rotated-secret", VOLC_SPEECH_API_KEY: "speech-secret" });
    expect(parsed.empty).toEqual(["MEDIAKIT_API_KEY"]);
    expect(parsed.ignored).toEqual(["JWT_SECRET"]);
  });

  test("rejects malformed and oversized files", () => {
    expect(() => parseEnvKey("not an assignment")).toThrow("KEY=VALUE");
    expect(() => parseEnvKey(`OPENAI_KEY="unterminated`)).toThrow("双引号未闭合");
    expect(() => parseEnvKey(`OPENAI_KEY=${"x".repeat(65 * 1024)}`)).toThrow("64KB");
  });

  test("serializes the template and removes only provider keys from a system env", () => {
    const serialized = serializeEnvKey({ OPENAI_KEY: "secret" });
    expect(serialized).toContain("OPENAI_KEY=secret");
    expect(serialized).toContain("MEDIAKIT_API_KEY=");
    expect(
      removeProviderEnvironment(
        `JWT_SECRET=system\nOPENAI_KEY=secret\nOPENAI_BASE_URL=https://example.test\nVIDEO_ANALYSIS_MODEL=model\nTOS_BUCKET=bucket\nREDIS_URL=redis://local\n`,
      ),
    ).toBe(`JWT_SECRET=system\nREDIS_URL=redis://local\n`);
  });
});
