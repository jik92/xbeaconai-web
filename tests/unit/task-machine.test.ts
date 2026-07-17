import { describe, expect, test } from "bun:test";
import { transitionTask } from "../../src/mocks/task-machine";

describe("task state machine", () => {
  test("moves a valid task through upload and processing", () => {
    const queued = transitionTask({ id: "t1", moduleId: "video-remix", title: "测试", status: "draft", progress: 0, createdAt: 1, updatedAt: 1 }, { type: "SUBMIT" });
    expect(queued.status).toBe("validating");
    expect(transitionTask(queued, { type: "VALID" }).status).toBe("uploading");
  });

  test("preserves progress when retrying a failed stage", () => {
    const task = { id: "t1", moduleId: "video-remix", title: "测试", status: "failed", progress: 48, failedStage: "analysis", createdAt: 1, updatedAt: 1 } as const;
    expect(transitionTask(task, { type: "RETRY" })).toMatchObject({ status: "queued", progress: 48 });
  });

  test("cancels an active task without discarding its progress", () => {
    const task = { id: "t2", moduleId: "video-cut", title: "长视频切分", status: "processing", progress: 57, createdAt: 1, updatedAt: 1 } as const;
    expect(transitionTask(task, { type: "CANCEL" })).toMatchObject({ status: "cancelled", progress: 57 });
  });
});
