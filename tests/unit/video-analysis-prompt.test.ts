import { describe, expect, test } from "bun:test";
import { buildVideoAnalysisPrompt } from "../../src/features/video-remix/video-analysis-prompt";

describe("buildVideoAnalysisPrompt", () => {
  test("is deterministic and includes the full reverse-analysis contract", () => {
    const first = buildVideoAnalysisPrompt({ durationSeconds: 15.092971 });
    const second = buildVideoAnalysisPrompt({ durationSeconds: 15.092971 });

    expect(first).toBe(second);
    expect(first).toContain("爆款二创复刻");
    expect(first).toContain("也可以采用悬念、对比、体验证明");
    expect(first).toContain("结构要稳定，内容表达可以根据素材充分发散");
    expect(first).toContain("所有分镜时长之和应与视频总时长基本一致");
    expect(first).toContain("可使用整数或 0.5 秒粒度");
    expect(first).toContain("每 3–4 秒自然眨眼");
    expect(first).toContain("统一要求 1080P 高清");
    expect(first).toContain("### 第一部分：全局基础设定");
    expect(first).toContain("### 第二部分：分镜内容");
    expect(first).toContain("人物动作描述：...");
    expect(first).toContain("光线风格分析：...");
    expect(first).toContain("15.09 秒");
  });

  test("does not hard-code facts that must be observed from the video", () => {
    const prompt = buildVideoAnalysisPrompt();

    expect(prompt).not.toContain("洪水淹没的大型仓储库房");
    expect(prompt).not.toContain("卡其色草编平顶礼帽");
    expect(prompt).not.toContain("咱这仓库啊");
    expect(prompt).toContain("看不清的品牌文字不要臆造");
  });

  test("injects verified speech evidence without changing the output contract", () => {
    const prompt = buildVideoAnalysisPrompt({
      durationSeconds: 15.09,
      speechTranscript: "完了姐妹们，昨天一场大雨仓库进水了。",
    });

    expect(prompt).toContain("## 已核验原声音轨转写");
    expect(prompt).toContain("完了姐妹们，昨天一场大雨仓库进水了。");
    expect(prompt).toContain("不要求在最终口播中逐字照抄");
  });

  test("tells the model to use every bound product image", () => {
    const prompt = buildVideoAnalysisPrompt({ productName: "草编礼帽", productImageCount: 5 });

    expect(prompt).toContain("已随视频同时提供 5 张");
    expect(prompt).toContain("不得只看第一张图");
    expect(prompt).toContain("颜色、材质、结构、Logo");
  });
});
