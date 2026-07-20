import { z } from "@hono/zod-openapi";
import { assertAdScriptModelAvailable, generateStructured } from "../server/ad-script/model";
import { AD_SCRIPT_MODEL } from "../server/ad-script/types";

const ResultSchema = z.object({ ok: z.literal(true), model: z.literal(AD_SCRIPT_MODEL) });

await assertAdScriptModelAvailable();
const result = await generateStructured(
  `只返回 JSON：{"ok":true,"model":"${AD_SCRIPT_MODEL}"}。不得添加其他字段或说明。`,
  ResultSchema,
  { maxTokens: 200 },
);

console.log(JSON.stringify({ capability: "ad-script-text", model: result.model, structuredOutput: result.ok }));
