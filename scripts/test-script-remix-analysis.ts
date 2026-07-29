import { mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { analyzeScriptRemix } from "../server/video-remix/script-analysis";

const imagePath = resolve(process.argv[2] || "");
if (!process.argv[2] || !(await Bun.file(imagePath).exists()))
  throw new Error("用法：bun scripts/test-script-remix-analysis.ts <商品图片路径>");

const script = `快闪开！
这一车裤子全涌出来了。
老板，这么多裤子该怎么处理？
这些高端女裤一下全部到货了，只能给直播间的姐姐们了。
裤子面料都是很好的，穿上显瘦又凉快。
想要的姐姐点头像进直播间，一人来拿一条。`;

const result = await analyzeScriptRemix({
  script,
  productName: "高腰阔腿女裤",
  productDescription: "",
  portrait: "",
  voice: "",
  productImages: [{ path: imagePath, mimeType: "image/jpeg", label: "Image1" }],
});

const outputDir = resolve("artifacts/api-tests/script-remix-analysis");
await mkdir(outputDir, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const output = {
  testedAt: new Date().toISOString(),
  model: result.model,
  image: basename(imagePath),
  script,
  usage: result.usage,
  productFacts: result.plan.productFacts,
  global: result.plan.global,
  shots: result.shots,
};
const jsonPath = resolve(outputDir, `${timestamp}.json`);
const markdownPath = resolve(outputDir, `${timestamp}.md`);
await Bun.write(jsonPath, `${JSON.stringify(output, null, 2)}\n`);
await Bun.write(
  markdownPath,
  result.shots.map((shot) => `# ${shot.title}（${shot.durationSeconds}秒）\n\n${shot.prompt}`).join("\n\n---\n\n"),
);

console.log(
  JSON.stringify(
    {
      model: result.model,
      productFacts: result.plan.productFacts,
      shotCount: result.shots.length,
      shots: result.shots.map((shot) => ({
        title: shot.title,
        durationSeconds: shot.durationSeconds,
        speech: shot.speech,
      })),
      jsonPath,
      markdownPath,
    },
    null,
    2,
  ),
);
