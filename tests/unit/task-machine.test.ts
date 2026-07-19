import { describe, expect, test } from "bun:test";
import type { MockTask } from "../../src/entities/types";
import { transitionTask } from "../../src/mocks/task-machine";

function task(status: MockTask["status"] = "draft", progress = 0): MockTask {
  return {
    id: "task-1",
    moduleId: "video-remix",
    title: "测试任务",
    status,
    progress,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("mock task state machine", () => {
  test("moves a submitted task through the successful workflow without lowering progress", () => {
    const validating = transitionTask(task(), { type: "SUBMIT" });
    const uploading = transitionTask(validating, { type: "VALID" });
    const queued = transitionTask(uploading, { type: "UPLOADED" });
    const processing = transitionTask(queued, { type: "START" });
    const progressed = transitionTask({ ...processing, progress: 60 }, { type: "PROGRESS", progress: 42 });
    const completed = transitionTask(progressed, { type: "SUCCEED" });

    expect(validating.status).toBe("validating");
    expect(uploading.progress).toBe(8);
    expect(queued.progress).toBe(18);
    expect(processing.progress).toBe(24);
    expect(progressed.progress).toBe(60);
    expect(completed).toMatchObject({
      status: "succeeded",
      progress: 100,
      result: "作品已生成，可预览或导出",
    });
  });

  test("rejects impossible transitions and permits retry after a failure", () => {
    expect(() => transitionTask(task(), { type: "SUCCEED" })).toThrow("无法从 draft 执行 SUCCEED");

    const failed = transitionTask(task("processing", 42), {
      type: "FAIL",
      stage: "analysis",
      message: "素材分析中断",
    });
    const retried = transitionTask(failed, { type: "RETRY" });

    expect(failed).toMatchObject({ status: "failed", failedStage: "analysis", message: "素材分析中断" });
    expect(retried).toMatchObject({ status: "queued", message: undefined });
  });
});
