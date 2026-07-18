import type { MockTask, ModuleId } from "@/entities/types";
import { db } from "@/lib/db";
import { transitionTask } from "./task-machine";

export type MockScenario = "success" | "fail-analysis" | "partial-batch" | "insufficient-credits";
const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(true), ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve(false);
      },
      { once: true },
    );
  });
export async function runMockTask(
  moduleId: ModuleId,
  title: string,
  onChange: (task: MockTask) => void,
  scenario: MockScenario = "success",
  signal?: AbortSignal,
) {
  let task: MockTask = {
    id: crypto.randomUUID(),
    moduleId,
    title,
    status: "draft",
    progress: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const update = async (event: Parameters<typeof transitionTask>[1]) => {
    task = transitionTask(task, event);
    await db.tasks.put(task);
    onChange(task);
  };
  const pause = async (ms: number) => {
    if (await wait(ms, signal)) return true;
    if (task.status !== "cancelled") await update({ type: "CANCEL" });
    return false;
  };
  await db.tasks.put(task);
  onChange(task);
  await update({ type: "SUBMIT" });
  if (scenario === "insufficient-credits") {
    if (!(await pause(260))) return task;
    await update({ type: "FAIL", stage: "billing", message: "创作点不足，请调整任务或充值" });
    return task;
  }
  if (!(await pause(260))) return task;
  await update({ type: "VALID" });
  if (!(await pause(340))) return task;
  await update({ type: "UPLOADED" });
  if (!(await pause(300))) return task;
  await update({ type: "START" });
  if (scenario === "fail-analysis") {
    if (!(await pause(520))) return task;
    await update({ type: "PROGRESS", progress: 42 });
    if (!(await pause(260))) return task;
    await update({ type: "FAIL", stage: "analysis", message: "素材分析中断，请检查文件后重试" });
    return task;
  }
  for (const progress of [38, 57, 76, 91]) {
    if (!(await pause(420))) return task;
    await update({ type: "PROGRESS", progress });
  }
  if (!(await pause(320))) return task;
  await update({ type: scenario === "partial-batch" ? "PARTIAL" : "SUCCEED" });
  return task;
}
