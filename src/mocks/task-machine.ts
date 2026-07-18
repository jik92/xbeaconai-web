import type { MockTask, TaskEvent, TaskStatus } from "@/entities/types";

const allowed: Record<TaskStatus, TaskEvent["type"][]> = {
  draft: ["SUBMIT", "CANCEL"],
  validating: ["VALID", "FAIL", "CANCEL"],
  uploading: ["UPLOADED", "FAIL", "CANCEL"],
  queued: ["START", "FAIL", "CANCEL"],
  processing: ["PROGRESS", "SUCCEED", "PARTIAL", "FAIL", "CANCEL"],
  succeeded: [],
  partially_succeeded: ["RETRY"],
  failed: ["RETRY"],
  cancelled: ["RETRY"],
};
export function transitionTask(task: MockTask, event: TaskEvent): MockTask {
  if (!allowed[task.status].includes(event.type)) throw new Error(`无法从 ${task.status} 执行 ${event.type}`);
  const base = { ...task, updatedAt: Date.now() };
  switch (event.type) {
    case "SUBMIT":
      return { ...base, status: "validating" };
    case "VALID":
      return { ...base, status: "uploading", progress: Math.max(task.progress, 8) };
    case "UPLOADED":
      return { ...base, status: "queued", progress: Math.max(task.progress, 18) };
    case "START":
      return { ...base, status: "processing", progress: Math.max(task.progress, 24) };
    case "PROGRESS":
      return { ...base, progress: Math.max(task.progress, Math.min(99, event.progress)) };
    case "SUCCEED":
      return { ...base, status: "succeeded", progress: 100, result: "作品已生成，可预览或导出" };
    case "PARTIAL":
      return { ...base, status: "partially_succeeded", result: "部分作品生成成功" };
    case "FAIL":
      return { ...base, status: "failed", failedStage: event.stage, message: event.message };
    case "CANCEL":
      return { ...base, status: "cancelled" };
    case "RETRY":
      return { ...base, status: "queued", message: undefined };
  }
}
