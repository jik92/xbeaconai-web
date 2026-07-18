import { getAuthToken } from "@/features/account/auth-context";
import { client } from "./generated/client.gen";
import { cancelJob, createJob, getJob, getModels, listJobs, retryJob, uploadMedia } from "./generated/sdk.gen";
import type { Job, ModuleId, SeedanceModelId } from "./generated/types.gen";

const configure = () =>
  client.setConfig({
    baseUrl: typeof window === "undefined" ? "http://127.0.0.1:8787" : window.location.origin,
    headers: authHeaders(),
  });
const authHeaders = () => {
  const token = getAuthToken();
  if (!token) throw new Error("请先登录");
  return { Authorization: `Bearer ${token}` };
};

export async function fetchJobs(moduleId: ModuleId) {
  configure();
  const { data } = await listJobs({ query: { moduleId }, headers: authHeaders(), throwOnError: true });
  return data?.jobs ?? [];
}
export async function fetchModels() {
  configure();
  const { data } = await getModels({ throwOnError: true });
  return data?.models ?? [];
}
export async function submitJob(
  moduleId: ModuleId,
  title: string,
  values: Record<string, string>,
  videoModel?: SeedanceModelId,
  idempotencyKey = crypto.randomUUID(),
) {
  configure();
  const { data } = await createJob({
    path: { moduleId },
    body: { title, values, videoModel, allowMockFallback: true },
    headers: { ...authHeaders(), "Idempotency-Key": idempotencyKey },
    throwOnError: true,
  });
  if (!data) throw new Error("任务创建失败");
  return data;
}
export async function fetchCreationCapabilities() {
  const response = await fetch("/api/creation/capabilities");
  if (!response.ok) throw new Error("创作模型目录加载失败");
  return response.json() as Promise<{
    models: import("@/features/ai-creation/ai-creation-composer").CreationModelCapability[];
  }>;
}
export async function uploadMediaFile(file: File) {
  configure();
  const { data } = await uploadMedia({ body: { file }, headers: authHeaders(), throwOnError: true });
  if (!data?.asset) throw new Error("文件上传失败");
  return data.asset;
}
export async function requestCancel(jobId: string) {
  configure();
  const { data } = await cancelJob({ path: { jobId }, headers: authHeaders(), throwOnError: true });
  if (!data) throw new Error("取消任务失败");
  return data;
}
export async function requestRetry(jobId: string) {
  configure();
  const { data } = await retryJob({ path: { jobId }, headers: authHeaders(), throwOnError: true });
  if (!data) throw new Error("重试任务失败");
  return data;
}
export async function fetchJob(jobId: string) {
  configure();
  const { data } = await getJob({ path: { jobId }, headers: authHeaders(), throwOnError: true });
  if (!data) throw new Error("任务不存在");
  return data;
}

export function watchJob(jobId: string, onChange: (job: Job) => void, onError?: () => void) {
  const controller = new AbortController();
  void (async () => {
    try {
      const response = await fetch(`/api/jobs/${jobId}/events`, {
        headers: { ...authHeaders(), Accept: "text/event-stream" },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error("任务状态流连接失败");
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = block
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (data) onChange(JSON.parse(data) as Job);
          boundary = buffer.indexOf("\n\n");
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) onError?.();
    }
  })();
  return () => controller.abort();
}

export async function authenticatedBlobUrl(url: string) {
  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) throw new Error("结果文件读取失败");
  return URL.createObjectURL(await response.blob());
}
export async function downloadAuthenticated(url: string, name: string) {
  const objectUrl = await authenticatedBlobUrl(url);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
