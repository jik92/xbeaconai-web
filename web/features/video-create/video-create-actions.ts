export function videoCreateActionAvailability(input: { hasScript: boolean; hasStoryboard: boolean }) {
  return {
    scriptLabel: "生成脚本",
    scriptLocked: input.hasStoryboard,
    storyboardLabel: input.hasStoryboard ? "分镜已生成" : "生成分镜",
    storyboardLocked: !input.hasScript || input.hasStoryboard,
  };
}
