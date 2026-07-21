import type { AssetFolder, AssetKind, LibraryAsset, LibraryProduct } from "@/entities/types";
import { getAuthToken } from "@/features/account/auth-context";
import { randomUuid } from "@/lib/random-id";
import { apiBaseUrl, apiUrl } from "./base-url";
import { client } from "./generated/client.gen";
import {
  cancelJob,
  createAdScriptAction,
  createAdScriptProject,
  createJob,
  createVideoCreateProject,
  deleteAsset as deleteAssetRequest,
  deleteProduct as deleteProductRequest,
  exportAdScriptVersion,
  generateVideoCreateShot,
  getAdScriptProject,
  getJob,
  getModels,
  getVideoCreateProject,
  listJobs,
  listVideoCreateProjects,
  parseAdScriptSource,
  regenerateVideoCreateSection,
  replaceVideoCreateShot,
  retryJob,
  runVideoCreateAction,
  saveAdScriptVersion,
  saveVideoCreateSection,
  updateVideoCreateProject,
  updateVideoCreateShotSettings,
  uploadMedia,
} from "./generated/sdk.gen";
import type {
  AdScriptInput,
  AdScriptProject,
  Job,
  ModuleId,
  SeedanceModelId,
  VideoCreateInput,
  VideoCreateProject,
} from "./generated/types.gen";

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

export async function fetchVideoCreateProjects() {
  configure();
  const { data } = await listVideoCreateProjects({ headers: authHeaders(), throwOnError: true });
  return data?.projects ?? [];
}

export async function fetchVideoCreateProject(projectId: string): Promise<VideoCreateProject> {
  configure();
  const { data } = await getVideoCreateProject({ path: { projectId }, headers: authHeaders(), throwOnError: true });
  if (!data) throw new Error("一键成片项目加载失败");
  return data;
}

export async function createVideoCreate(input: VideoCreateInput, title: string, idempotencyKey = randomUuid()) {
  configure();
  const { data } = await createVideoCreateProject({
    body: { input, title },
    headers: { ...authHeaders(), "Idempotency-Key": idempotencyKey },
    throwOnError: true,
  });
  if (!data) throw new Error("一键成片项目创建失败");
  return data;
}

export async function updateVideoCreate(input: VideoCreateProject, values: VideoCreateInput) {
  configure();
  const { data } = await updateVideoCreateProject({
    path: { projectId: input.project.id },
    body: { expectedVersion: input.project.version, input: values },
    headers: authHeaders(),
    throwOnError: true,
  });
  if (!data) throw new Error("一键成片参数保存失败");
  return data;
}

export async function runVideoCreateProjectAction(
  projectId: string,
  action: "analyze" | "script" | "storyboard" | "compose",
) {
  configure();
  const { data } = await runVideoCreateAction({
    path: { projectId, action },
    headers: { ...authHeaders(), "Idempotency-Key": randomUuid() },
    throwOnError: true,
  });
  if (!data) throw new Error("一键成片任务提交失败");
  return data;
}

export async function saveVideoCreateScriptSection(input: {
  projectId: string;
  sectionId: string;
  expectedVersionId: string;
  text: string;
  durationSec: number;
}) {
  configure();
  const { data } = await saveVideoCreateSection({
    path: { projectId: input.projectId, sectionId: input.sectionId },
    body: { expectedVersionId: input.expectedVersionId, text: input.text, durationSec: input.durationSec },
    headers: authHeaders(),
    throwOnError: true,
  });
  if (!data) throw new Error("脚本保存失败");
  return data;
}

export async function regenerateVideoCreateScriptSection(input: {
  projectId: string;
  sectionId: string;
  expectedVersionId: string;
}) {
  configure();
  const { data } = await regenerateVideoCreateSection({
    path: { projectId: input.projectId, sectionId: input.sectionId },
    body: { expectedVersionId: input.expectedVersionId },
    headers: { ...authHeaders(), "Idempotency-Key": randomUuid() },
    throwOnError: true,
  });
  if (!data) throw new Error("脚本换版任务提交失败");
  return data;
}

export async function generateVideoCreateShotVideo(projectId: string, shotId: string) {
  configure();
  const { data } = await generateVideoCreateShot({
    path: { projectId, shotId },
    headers: { ...authHeaders(), "Idempotency-Key": randomUuid() },
    throwOnError: true,
  });
  if (!data) throw new Error("分镜视频任务提交失败");
  return data;
}

export async function replaceVideoCreateShotVideo(projectId: string, shotId: string, assetId: string) {
  configure();
  const { data } = await replaceVideoCreateShot({
    path: { projectId, shotId },
    body: { assetId },
    headers: authHeaders(),
    throwOnError: true,
  });
  if (!data) throw new Error("替代视频保存失败");
  return data;
}

export async function updateVideoCreateShotOptions(
  projectId: string,
  shotId: string,
  options: { audioEnabled: boolean; subtitleEnabled: boolean },
) {
  configure();
  const { data } = await updateVideoCreateShotSettings({
    path: { projectId, shotId },
    body: options,
    headers: authHeaders(),
    throwOnError: true,
  });
  if (!data) throw new Error("分镜设置保存失败");
  return data;
}
export async function parseExistingAdScript(sourceScript: string, idempotencyKey = randomUuid()) {
  configure();
  const { data } = await parseAdScriptSource({
    body: { sourceScript },
    headers: { ...authHeaders(), "Idempotency-Key": idempotencyKey },
    throwOnError: true,
  });
  if (!data) throw new Error("脚本解析任务创建失败");
  return data;
}
export async function createAdScript(input: AdScriptInput, idempotencyKey = randomUuid()) {
  configure();
  const { data } = await createAdScriptProject({
    body: input,
    headers: { ...authHeaders(), "Idempotency-Key": idempotencyKey },
    throwOnError: true,
  });
  if (!data) throw new Error("口播脚本任务创建失败");
  return data;
}
export async function fetchAdScriptProject(projectId: string): Promise<AdScriptProject> {
  configure();
  const { data } = await getAdScriptProject({ path: { projectId }, headers: authHeaders(), throwOnError: true });
  if (!data) throw new Error("口播脚本项目加载失败");
  return data;
}
export async function saveAdScriptHumanVersion(input: {
  projectId: string;
  variantId: string;
  expectedVersionId: string;
  script: string;
}) {
  configure();
  const { data } = await saveAdScriptVersion({
    path: { projectId: input.projectId, variantId: input.variantId },
    body: { expectedVersionId: input.expectedVersionId, script: input.script },
    headers: authHeaders(),
    throwOnError: true,
  });
  if (!data) throw new Error("脚本版本保存失败");
  return data;
}
export async function runAdScriptAction(input: {
  projectId: string;
  variantId: string;
  versionId: string;
  action: "rescore" | "continue";
}) {
  configure();
  const { data } = await createAdScriptAction({
    path: { projectId: input.projectId, variantId: input.variantId, action: input.action },
    body: { versionId: input.versionId },
    headers: { ...authHeaders(), "Idempotency-Key": randomUuid() },
    throwOnError: true,
  });
  if (!data) throw new Error("脚本操作创建失败");
  return data;
}
export async function downloadAdScriptVersion(input: {
  projectId: string;
  variantId: string;
  versionId: string;
  format: "txt" | "md";
}) {
  configure();
  const { data } = await exportAdScriptVersion({
    path: { projectId: input.projectId, variantId: input.variantId },
    query: { versionId: input.versionId, format: input.format },
    headers: authHeaders(),
    throwOnError: true,
  });
  if (typeof data !== "string") throw new Error("脚本导出失败");
  const url = URL.createObjectURL(new Blob([data], { type: input.format === "md" ? "text/markdown" : "text/plain" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `口播脚本.${input.format}`;
  anchor.click();
  URL.revokeObjectURL(url);
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
export async function fetchLibraryAssets(kind: Exclude<AssetKind, "product">, folderId?: string) {
  const params = new URLSearchParams({ kind });
  if (folderId) params.set("folderId", folderId);
  const response = await fetch(apiUrl(`/api/assets?${params}`), { headers: authHeaders() });
  if (!response.ok) throw new Error("资产列表加载失败");
  const data = (await response.json()) as { assets: LibraryAsset[] };
  return data.assets;
}
export async function deleteLibraryAsset(assetId: string) {
  configure();
  await deleteAssetRequest({ path: { assetId }, headers: authHeaders(), throwOnError: true });
}
export async function deleteLibraryProduct(productId: string) {
  configure();
  await deleteProductRequest({ path: { productId }, headers: authHeaders(), throwOnError: true });
}
export async function saveAssetMetadata(
  assetId: string,
  metadata: { width?: number; height?: number; durationSec?: number },
) {
  const response = await fetch(apiUrl(`/api/assets/${assetId}/metadata`), {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(metadata),
  });
  if (!response.ok) throw new Error("素材元数据保存失败");
  return ((await response.json()) as { asset: LibraryAsset }).asset;
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
  onProgress?: (percent: number) => void,
  metadata?: { width?: number; height?: number; durationSec?: number },
) {
  if (kind === "media") {
    const directAsset = await uploadLibraryAssetDirect(file, displayName, description, folderId, onProgress, metadata);
    if (directAsset) return directAsset;
  }
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

interface DirectUploadAuthorization {
  uploadUrl: string;
  uploadToken: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: string;
}

async function responseError(response: Response, fallback: string) {
  const data = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  return { code: data?.error?.code, message: data?.error?.message || fallback };
}

function putDirectFile(authorization: DirectUploadAuthorization, file: File, onProgress?: (percent: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(authorization.method, authorization.uploadUrl);
    for (const [name, value] of Object.entries(authorization.headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };
    request.onerror = () => reject(new Error("TOS 直传失败，请检查网络或存储桶 CORS 配置"));
    request.onabort = () => reject(new Error("TOS 直传已取消"));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress?.(100);
        resolve();
      } else reject(new Error(`TOS 直传失败（HTTP ${request.status || "未知"}）`));
    };
    request.send(file);
  });
}

async function uploadLibraryAssetDirect(
  file: File,
  displayName: string,
  description: string,
  folderId?: string,
  onProgress?: (percent: number) => void,
  metadata?: { width?: number; height?: number; durationSec?: number },
): Promise<LibraryAsset | undefined> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const mimeType =
    file.type ||
    ({ mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" } as Record<string, string>)[extension ?? ""] ||
    "application/octet-stream";
  const initResponse = await fetch(apiUrl("/api/uploads/direct"), {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      mimeType,
      size: file.size,
      displayName,
      description: description.trim() || undefined,
      folderId,
      ...metadata,
    }),
  });
  if (!initResponse.ok) {
    const error = await responseError(initResponse, "无法申请 TOS 直传地址");
    if (initResponse.status === 503 && error.code === "DIRECT_UPLOAD_UNAVAILABLE") return undefined;
    throw new Error(error.message);
  }
  const authorization = (await initResponse.json()) as DirectUploadAuthorization;
  await putDirectFile(authorization, file, onProgress);
  const completeResponse = await fetch(apiUrl("/api/uploads/direct/complete"), {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ uploadToken: authorization.uploadToken }),
  });
  if (!completeResponse.ok) throw new Error((await responseError(completeResponse, "素材回写失败")).message);
  return ((await completeResponse.json()) as { asset: LibraryAsset }).asset;
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
export async function setDefaultAssetFolder(folderId: string) {
  const response = await fetch(apiUrl(`/api/asset-folders/${folderId}/default`), {
    method: "PUT",
    headers: authHeaders(),
  });
  const data = (await response.json().catch(() => null)) as {
    folder?: AssetFolder;
    error?: { message?: string };
  } | null;
  if (!response.ok || !data?.folder) throw new Error(data?.error?.message || "默认文件夹设置失败");
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

// ── Share content import (multi-platform) ──────────────────────────────

export interface ShareCandidate {
  raw: string;
  platformId: string;
  confidence: "high" | "medium" | "low";
  label: string;
}

export async function parseShareContent(text: string): Promise<ShareCandidate[]> {
  configure();
  const response = await fetch(apiUrl("/api/imports/share-content/parse"), {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) throw new Error("内容解析失败");
  const body = (await response.json()) as { candidates: ShareCandidate[] };
  return body.candidates ?? [];
}

export async function createShareImport(candidate: ShareCandidate, folderId: string): Promise<Job> {
  configure();
  const response = await fetch(apiUrl("/api/imports/share-content"), {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ candidate, folderId }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error((body as { error?: { message?: string } }).error?.message ?? "创建导入任务失败");
  }
  return (await response.json()) as Job;
}

export async function fetchShareImport(jobId: string): Promise<Job> {
  configure();
  const response = await fetch(apiUrl(`/api/imports/share-content/${jobId}`), {
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error("导入任务不存在");
  return (await response.json()) as Job;
}
