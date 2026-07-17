import { db } from "@/lib/db";
import type { MockTask, ModuleId } from "@/entities/types";
import { transitionTask } from "./task-machine";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export async function runMockTask(moduleId: ModuleId, title: string, onChange: (task: MockTask) => void, scenario: "success" | "fail-analysis" = "success") {
  let task: MockTask = { id: crypto.randomUUID(), moduleId, title, status: "draft", progress: 0, createdAt: Date.now(), updatedAt: Date.now() };
  const update = async (event: Parameters<typeof transitionTask>[1]) => { task = transitionTask(task, event); await db.tasks.put(task); onChange(task); };
  await db.tasks.put(task); onChange(task);
  await update({ type: "SUBMIT" }); await wait(260); await update({ type: "VALID" }); await wait(340); await update({ type: "UPLOADED" }); await wait(300); await update({ type: "START" });
  if (scenario === "fail-analysis") { await wait(520); await update({ type: "PROGRESS", progress: 42 }); await wait(260); await update({ type: "FAIL", stage: "analysis", message: "素材分析中断，请检查文件后重试" }); return task; }
  for (const progress of [38, 57, 76, 91]) { await wait(420); await update({ type: "PROGRESS", progress }); }
  await wait(320); await update({ type: "SUCCEED" }); return task;
}
