import type { AssetFolder, AssetKind, LibraryAsset, LibraryProduct } from "@/entities/types";
import { getAuthToken } from "@/features/account/auth-context";
import { randomUuid } from "@/lib/random-id";
import { apiBaseUrl, apiUrl } from "./base-url";
import { client } from "./generated/client.gen";
import { cancelJob, createJob, getJob, getModels, listJobs, retryJob, uploadMedia } from "./generated/sdk.gen";
import type { Job, ModuleId, SeedanceModelId } from "./generated/types.gen";

const configure = () =>
  client.setConfig({
    baseUrl: apiBaseUrl(),
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
  idempotencyKey = randomUuid(),
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
  const response = await fetch(apiUrl("/api/creation/capabilities"));
  if (!response.ok) throw new Error("创作模型目录加载失败");
  return response.json() as Promise<{
    models: import("@/features/ai-creation/ai-creation-composer").CreationModelCapability[];
  }>;
}
export async function uploadMediaFile(file: File, folderId?: string) {
  if (folderId) return uploadLibraryAsset(file, "media", file.name.replace(/\.[^.]+$/, ""), "", folderId);
  configure();
  const { data } = await uploadMedia({ body: { file }, headers: authHeaders(), throwOnError: true });
  if (!data?.asset) throw new Error("文件上传失败");
  return data.asset;
}
export async function importDouyinVideo(input: {
  url: string;
  displayName?: string;
  folderId?: string;
  authorized: true;
}) {
  const response = await fetch(apiUrl("/api/imports/douyin"), {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await response.json().catch(() => null)) as {
    asset?: LibraryAsset;
    error?: { message?: string };
  } | null;
  if (!response.ok || !data?.asset) throw new Error(data?.error?.message || "抖音视频导入失败");
  return data.asset;
}
export async function fetchLibraryAssets(kind: Exclude<AssetKind, "product">, folderId?: string) {
  const params = new URLSearchParams({ kind });
  if (folderId) params.set("folderId", folderId);
  const response = await fetch(apiUrl(`/api/assets?${params}`), { headers: authHeaders() });
  if (!response.ok) throw new Error("资产列表加载失败");
  const data = (await response.json()) as { assets: LibraryAsset[] };
  return data.assets;
}
export async function fetchProducts() {
  const response = await fetch(apiUrl("/api/products"), { headers: authHeaders() });
  if (!response.ok) throw new Error("商品列表加载失败");
  return ((await response.json()) as { products: LibraryProduct[] }).products;
}
export async function uploadProduct(input: {
  files: File[];
  name: string;
  description: string;
  sharingScope: LibraryProduct["sharingScope"];
}) {
  const body = new FormData();
  input.files.forEach((file) => {
    body.append("files", file);
  });
  body.set("productName", input.name);
  body.set("description", input.description);
  body.set("sharingScope", input.sharingScope);
  const response = await fetch(apiUrl("/api/products"), { method: "POST", headers: authHeaders(), body });
  const data = (await response.json().catch(() => null)) as {
    product?: LibraryProduct;
    error?: { message?: string };
  } | null;
  if (!response.ok || !data?.product) throw new Error(data?.error?.message || "商品上传失败");
  return data.product;
}
interface RemixMaterialFile {
  id?: number | string | null;
  filename: string;
  objectKey: string;
  fileMd5?: string | null;
  fileUrl: string;
  coverUrl: string;
  fileType: "IMAGE" | "VIDEO" | "AUDIO";
  metaId?: string | null;
  assetId?: string | null;
  duration?: number | null;
  durationSec?: number | null;
  arkVideoUrl?: string | null;
  aiDescription?: string | null;
  reasoningEffort?: "low" | "medium" | "high";
}
export interface RemixProjectRequest {
  projectName: string;
  product: {
    id: number | string | null;
    productName: string;
    productImages: RemixMaterialFile[];
    productFormMetaList: unknown[] | null;
    productFormDesc: string | null;
  };
  demand: string;
  rawMaterialFiles: RemixMaterialFile[];
  portraitAssets: Array<{
    id?: number | string | null;
    assetName: string;
    fileInfo: Array<{
      fileUrl: string;
      coverUrl: string;
      fileType: "IMAGE";
      assetId?: string | null;
    }>;
    description: string;
    gender: string;
    age?: number | null;
    occupation: string;
  }>;
}
export async function generateRemixProject(input: RemixProjectRequest, idempotencyKey = randomUuid()) {
  const response = await fetch(apiUrl("/api/video-remix/project/generate"), {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(input),
  });
  const data = (await response.json().catch(() => null)) as Job | { error?: { message?: string } } | null;
  if (!response.ok)
    throw new Error(data && "error" in data ? data.error?.message || "视频解析提交失败" : "视频解析提交失败");
  if (!data || !("status" in data)) throw new Error("视频解析响应无效");
  return data;
}
export async function uploadLibraryAsset(
  file: File,
  kind: Exclude<AssetKind, "product">,
  displayName: string,
  description = "",
  folderId?: string,
) {
  const body = new FormData();
  body.set("file", file);
  body.set("kind", kind);
  body.set("displayName", displayName);
  if (description.trim()) body.set("description", description.trim());
  if (folderId) body.set("folderId", folderId);
  const response = await fetch(apiUrl("/api/uploads"), { method: "POST", headers: authHeaders(), body });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(data?.error?.message || "资产上传失败");
  }
  const data = (await response.json()) as { asset: LibraryAsset & { displayName?: string } };
  return { ...data.asset, name: data.asset.displayName || data.asset.name } as LibraryAsset;
}
export async function fetchAssetFolders() {
  const response = await fetch(apiUrl("/api/asset-folders"), { headers: authHeaders() });
  if (!response.ok) throw new Error("素材文件夹加载失败");
  return ((await response.json()) as { folders: AssetFolder[] }).folders;
}
export async function createAssetFolder(name: string, parentId?: string) {
  const response = await fetch(apiUrl("/api/asset-folders"), {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ name, parentId }),
  });
  const data = (await response.json().catch(() => null)) as {
    folder?: AssetFolder;
    error?: { message?: string };
  } | null;
  if (!response.ok || !data?.folder) throw new Error(data?.error?.message || "文件夹创建失败");
  return data.folder;
}
export async function renameAssetFolder(folderId: string, name: string) {
  const response = await fetch(apiUrl(`/api/asset-folders/${folderId}`), {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const data = (await response.json().catch(() => null)) as {
    folder?: AssetFolder;
    error?: { message?: string };
  } | null;
  if (!response.ok || !data?.folder) throw new Error(data?.error?.message || "文件夹重命名失败");
  return data.folder;
}
export async function deleteAssetFolder(folderId: string) {
  const response = await fetch(apiUrl(`/api/asset-folders/${folderId}`), { method: "DELETE", headers: authHeaders() });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(data?.error?.message || "文件夹删除失败");
  }
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
      const response = await fetch(apiUrl(`/api/jobs/${jobId}/events`), {
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
    } catch (_error) {
      if (!controller.signal.aborted) onError?.();
    }
  })();
  return () => controller.abort();
}

export async function authenticatedBlobUrl(url: string) {
  const response = await fetch(apiUrl(url), { headers: authHeaders() });
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
