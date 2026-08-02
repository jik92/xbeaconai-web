import type { AssetFolder, AssetKind, LibraryAsset, LibraryProduct } from "@/entities/types";
import { getAuthToken } from "@/features/account/auth-context";
import { randomUuid } from "@/lib/random-id";
import type { PortraitReference } from "../../shared/portraits/portrait-reference";
import type { PortraitGender } from "../../shared/portraits/portrait-tags";
import type { RemixPromptTool, RemixPromptToolConfig } from "../../shared/video-remix/prompt-tools";
import { apiBaseUrl, apiUrl } from "./base-url";
import { client } from "./generated/client.gen";
import {
  applyVideoCreateShotMaterialVersion as applyVideoCreateShotMaterialVersionRequest,
  batchGenerateVideoCreateAudio as batchGenerateVideoCreateAudioRequest,
  batchGenerateVideoCreateShots,
  cancelJob,
  clearVideoCreateScript as clearVideoCreateScriptRequest,
  createAdScriptAction,
  createAdScriptProject,
  createAiGenerateJob as createAiGenerateJobRequest,
  createDownloadTicket,
  createJob,
  createMediaUnderstandJob as createMediaUnderstandJobRequest,
  createScriptRemixNextCompose,
  createScriptRemixNextProject,
  createScriptRemixNextReferenceImage,
  createScriptRemixNextShotGeneration,
  createScriptRemixNextStoryboard,
  createVideoCreateProject,
  createVideoRemixComposeJob,
  createVideoRemixPromptToolJob,
  createVideoRemixShotGenerationJob,
  deleteAdminCredential,
  deleteAsset as deleteAssetRequest,
  deleteProduct as deleteProductRequest,
  generateVideoCreateShot,
  getAdminCredentialDoctorResults,
  getAdminProviderAudit,
  getAdScriptProject,
  getJob,
  getMediaUnderstandCapabilities,
  getModels,
  getProviderFeatures,
  getVideoCreateProject,
  getVideoCreateShotGenerationDraft as getVideoCreateShotGenerationDraftRequest,
  getVideoRemixProject,
  grantAdminUserCredits,
  importAdminEnvKey,
  listAdminCredentials,
  listAdminJobs,
  listAdminProviderAudits,
  listAdminUsers,
  listAdScriptProjects,
  listCustomPortraits,
  listJobs,
  listVideoCreateProjects,
  listVideoCreateShotMaterialVersions,
  listVideoRemixProjects,
  listVideoRemixShotGenerationJobs,
  parseAdScriptSource,
  preflightQwenVoiceSample as preflightQwenVoiceSampleRequest,
  previewVideoCreateVoice as previewVideoCreateVoiceRequest,
  processVideoCreateShotMaterial,
  regenerateVideoCreateSection,
  registerCustomPortrait,
  releaseAdminUsers,
  replaceVideoCreateShot,
  retryJob,
  regenerateScriptRemixNextAnalysis,
  runAdminCredentialDoctor as runAdminCredentialDoctorRequest,
  runVideoCreateAction,
  saveAdScriptVersion,
  saveVideoCreateSection,
  stopAllAdminJobs as stopAllAdminJobsRequest,
  updateAdminCredential,
  updateAdminUserStatus,
  updateAllVideoCreateShotSettings,
  updateVideoCreateMediaSettings as updateVideoCreateMediaSettingsRequest,
  updateVideoCreateProject,
  updateVideoCreateShotSettings,
  updateVideoRemixProject,
  updateScriptRemixNextProject,
} from "./generated/sdk.gen";
import type {
  AdScriptInput,
  AdScriptProject,
  CreateAiGenerateJobData,
  CreateDownloadTicketData,
  CreateMediaUnderstandJobData,
  CreateScriptRemixNextProjectData,
  CreateScriptRemixNextShotGenerationData,
  CreateScriptRemixNextStoryboardData,
  CreateScriptRemixNextReferenceImageData,
  CreateScriptRemixNextComposeData,
  UpdateScriptRemixNextProjectData,
  GenerateVideoCreateShotData,
  GetAdminProviderAuditResponse,
  GetCreationCapabilitiesResponse,
  GetMediaUnderstandCapabilitiesResponse,
  GetProviderFeaturesResponse,
  GetVideoCreateShotGenerationDraftResponse,
  GetVideoRemixProjectResponse,
  Job,
  ListAdminCredentialsResponse,
  ListAdminJobsResponse,
  ListAdminProviderAuditsData,
  ListAdminProviderAuditsResponse,
  ListAdminUsersResponse,
  ListCustomPortraitsResponse,
  ListVideoCreateShotMaterialVersionsResponse,
  ListVideoRemixProjectsResponse,
  ModuleId,
  ProviderCredentialName,
  ReleaseAdminUsersResponse,
  RunAdminCredentialDoctorResponse,
  SeedanceModelId,
  StopAllAdminJobsResponse,
  VideoCreateInput,
  VideoCreateProject,
} from "./generated/types.gen";

export type AdminCredential = ListAdminCredentialsResponse["credentials"][number];
export type AdminJob = ListAdminJobsResponse["jobs"][number];
export type AdminProviderAudit = ListAdminProviderAuditsResponse["audits"][number];
export type AdminProviderAuditDetail = GetAdminProviderAuditResponse;
export type AdminUser = ListAdminUsersResponse["users"][number];
export type AdminAccountReleaseResult = ReleaseAdminUsersResponse["results"][number];
export type AdminCredentialDoctorResult = RunAdminCredentialDoctorResponse["results"][number];
export type ProviderFeatures = GetProviderFeaturesResponse;
export type AdminStopAllJobsResult = StopAllAdminJobsResponse;
export type RemixProjectSummary = ListVideoRemixProjectsResponse["projects"][number];
export type RemixProjectDetail = GetVideoRemixProjectResponse;
export type VideoCreateMaterialVersion = ListVideoCreateShotMaterialVersionsResponse["versions"][number];
export type CustomPortrait = ListCustomPortraitsResponse["portraits"][number];
export type DownloadResource = CreateDownloadTicketData["body"];
export type MediaUnderstandCapabilities = GetMediaUnderstandCapabilitiesResponse;
export type ScriptRemixNextCreateInput = NonNullable<CreateScriptRemixNextProjectData["body"]>;
export type ScriptRemixNextWorkspaceInput = NonNullable<UpdateScriptRemixNextProjectData["body"]>["workspace"];

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

export async function fetchAllJobs() {
  configure();
  const { data } = await listJobs({ headers: authHeaders(), throwOnError: true });
  return data?.jobs ?? [];
}

export async function createScriptRemixNext(input: ScriptRemixNextCreateInput, idempotencyKey = randomUuid()) {
  configure();
  const { data } = await createScriptRemixNextProject({
    body: input,
    headers: { ...authHeaders(), "Idempotency-Key": idempotencyKey },
    throwOnError: true,
  });
  if (!data) throw new Error("脚本解析任务创建失败");
  return data;
}

export async function regenerateScriptRemixNext(projectId: string, idempotencyKey = randomUuid()) {
  configure();
  const { data } = await regenerateScriptRemixNextAnalysis({
    path: { projectId },
    headers: { ...authHeaders(), "Idempotency-Key": idempotencyKey },
    throwOnError: true,
  });
  if (!data) throw new Error("脚本重新解析任务创建失败");
  return data;
}

export async function saveScriptRemixNext(
  projectId: string,
  input: NonNullable<UpdateScriptRemixNextProjectData["body"]>,
) {
  configure();
  const { data } = await updateScriptRemixNextProject({
    path: { projectId },
    body: input,
    headers: authHeaders(),
    throwOnError: true,
  });
  if (!data) throw new Error("新版脚本二创项目保存失败");
  return data;
}

export async function generateScriptRemixNextStoryboard(
  input: NonNullable<CreateScriptRemixNextStoryboardData["body"]>,
  idempotencyKey = randomUuid(),
) {
  configure();
  const { data } = await createScriptRemixNextStoryboard({
    body: input,
    headers: { ...authHeaders(), "Idempotency-Key": idempotencyKey },
    throwOnError: true,
  });
  if (!data) throw new Error("九宫格任务创建失败");
  return data;
}

export async function generateScriptRemixNextReferenceImage(
  input: NonNullable<CreateScriptRemixNextReferenceImageData["body"]>,
  idempotencyKey = randomUuid(),
) {
  configure();
  const { data } = await createScriptRemixNextReferenceImage({
    body: input,
    headers: { ...authHeaders(), "Idempotency-Key": idempotencyKey },
    throwOnError: true,
  });
  if (!data) throw new Error("单格参考图任务创建失败");
  return data;
}

export async function generateScriptRemixNextShot(
  input: NonNullable<CreateScriptRemixNextShotGenerationData["body"]>,
  idempotencyKey = randomUuid(),
) {
  configure();
  const { data } = await createScriptRemixNextShotGeneration({
    body: input,
    headers: { ...authHeaders(), "Idempotency-Key": idempotencyKey },
    throwOnError: true,
  });
  if (!data) throw new Error("分镜视频任务创建失败");
  return data;
}

export async function composeScriptRemixNext(
  input: NonNullable<CreateScriptRemixNextComposeData["body"]>,
  idempotencyKey = randomUuid(),
) {
  configure();
  const { data } = await createScriptRemixNextCompose({
    body: input,
    headers: { ...authHeaders(), "Idempotency-Key": idempotencyKey },
    throwOnError: true,
  });
  if (!data) throw new Error("合片任务创建失败");
  return data;
}

export async function fetchAdminCredentials() {
  configure();
  const { data } = await listAdminCredentials({ headers: authHeaders(), throwOnError: true });
  return data?.credentials ?? [];
}

export async function fetchProviderFeatures() {
  configure();
  const { data } = await getProviderFeatures({
    headers: authHeaders(),
    cache: "no-store",
    throwOnError: true,
  });
  if (!isProviderFeaturesResponse(data)) throw new Error("Provider 状态响应无效");
  return data;
}

export function isProviderFeaturesResponse(
  data: unknown,
): data is NonNullable<Awaited<ReturnType<typeof getProviderFeatures>>["data"]> {
  if (!data || typeof data !== "object") return false;
  const candidate = data as { modules?: unknown; operations?: unknown };
  return Boolean(
    candidate.modules &&
      typeof candidate.modules === "object" &&
      candidate.operations &&
      typeof candidate.operations === "object",
  );
}

export async function fetchAdminCredentialDoctorResults() {
  configure();
  const { data } = await getAdminCredentialDoctorResults({ headers: authHeaders(), throwOnError: true });
  return data?.results ?? [];
}

export async function saveAdminCredential(name: ProviderCredentialName, value: string) {
  configure();
  const { data } = await updateAdminCredential({
    path: { name },
    body: { value },
    headers: authHeaders(),
    throwOnError: true,
  });
  if (!data) throw new Error("密钥更新失败");
  return data;
}

export async function removeAdminCredential(name: ProviderCredentialName) {
  configure();
  const { data } = await deleteAdminCredential({ path: { name }, headers: authHeaders(), throwOnError: true });
  if (!data) throw new Error("密钥删除失败");
  return data;
}

export async function uploadAdminEnvKey(file: File) {
  configure();
  const { data } = await importAdminEnvKey({ body: { file }, headers: authHeaders(), throwOnError: true });
  if (!data) throw new Error(".env.key 导入失败");
  return data;
}

export async function runAdminCredentialDoctor() {
  configure();
  const { data } = await runAdminCredentialDoctorRequest({ headers: authHeaders(), throwOnError: true });
  if (!data) throw new Error("密钥检测失败");
  return data.results;
}

export async function fetchAdminJobs(query: {
  page: number;
  pageSize: number;
  moduleId?: ModuleId;
  status?: AdminJob["status"];
  phone?: string;
}) {
  configure();
  const { data } = await listAdminJobs({ query, headers: authHeaders(), throwOnError: true });
  if (!data) throw new Error("队列任务加载失败");
  return data;
}

export async function fetchAdminProviderAudits(query: NonNullable<ListAdminProviderAuditsData["query"]>) {
  configure();
  const { data } = await listAdminProviderAudits({ query, headers: authHeaders(), throwOnError: true });
  if (!data) throw new Error("审计日志加载失败");
  return data;
}

export async function fetchAdminProviderAudit(auditId: string) {
  configure();
  const { data } = await getAdminProviderAudit({ path: { auditId }, headers: authHeaders(), throwOnError: true });
  if (!data) throw new Error("审计详情加载失败");
  return data;
}

export async function stopAllAdminQueueJobs() {
  configure();
  const { data } = await stopAllAdminJobsRequest({ headers: authHeaders(), throwOnError: true });
  if (!data) throw new Error("停止任务失败");
  return data;
}

export async function fetchAdminUsers(query: {
  page: number;
  pageSize: number;
  query?: string;
  status?: AdminUser["status"];
}) {
  configure();
  const { data } = await listAdminUsers({ query, headers: authHeaders(), throwOnError: true });
  if (!data) throw new Error("用户列表加载失败");
  return data;
}

export async function grantCreditsToAdminUser(userId: string, credits: number, idempotencyKey: string) {
  configure();
  const { data } = await grantAdminUserCredits({
    path: { userId },
    body: { credits },
    headers: { ...authHeaders(), "Idempotency-Key": idempotencyKey },
    throwOnError: true,
  });
  if (!data) throw new Error("用户充值失败");
  return data;
}

export async function setAdminUserStatus(userId: string, status: "active" | "disabled") {
  configure();
  const { data } = await updateAdminUserStatus({
    path: { userId },
    body: { status },
    headers: authHeaders(),
    throwOnError: true,
  });
  if (!data) throw new Error("用户状态更新失败");
  return data;
}
export async function releaseSelectedAdminUsers(userIds: string[]) {
  configure();
  const { data } = await releaseAdminUsers({
    body: { userIds },
    headers: authHeaders(),
    throwOnError: true,
  });
  if (!data) throw new Error("账号释放失败");
  return data;
}
export async function fetchModels() {
  configure();
  const { data } = await getModels({ throwOnError: true });
  return data?.models ?? [];
}

export async function fetchVideoCreateProjects(input: {
  query?: string;
  status?: VideoCreateProject["project"]["status"];
  page: number;
  pageSize: number;
}) {
  configure();
  const { data } = await listVideoCreateProjects({ query: input, headers: authHeaders(), throwOnError: true });
  if (!data) throw new Error("一键成片生成记录加载失败");
  return data;
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

export async function renameVideoCreateProject(projectId: string, expectedVersion: number, title: string) {
  configure();
  const { data } = await updateVideoCreateProject({
    path: { projectId },
    body: { expectedVersion, title },
    headers: authHeaders(),
    throwOnError: true,
  });
  if (!data) throw new Error("一键成片项目重命名失败");
  return data;
}

export async function clearVideoCreateScript(projectId: string) {
  configure();
  const { data } = await clearVideoCreateScriptRequest({
    path: { projectId },
    headers: authHeaders(),
    throwOnError: true,
  });
  if (!data) throw new Error("脚本清除失败");
  return data;
}

export async function runVideoCreateProjectAction(
  projectId: string,
  action: "analyze" | "script" | "storyboard" | "compose" | "full",
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

export type VideoCreateShotGenerationOptions = {
  videoModel: NonNullable<VideoCreateInput["videoModel"]>;
  ratio: NonNullable<VideoCreateInput["ratio"]>;
  resolution: "480p" | "720p";
  generateAudio: boolean;
};

export type VideoCreateShotGenerationDraft = GetVideoCreateShotGenerationDraftResponse;
export type VideoCreateShotGenerationSubmitOptions = GenerateVideoCreateShotData["body"];

export async function fetchVideoCreateShotGenerationDraft(projectId: string, shotId: string) {
  configure();
  const { data } = await getVideoCreateShotGenerationDraftRequest({
    path: { projectId, shotId },
    headers: authHeaders(),
    throwOnError: true,
  });
  if (!data) throw new Error("分镜视频生成参数加载失败");
  return data;
}

export async function generateVideoCreateShotVideo(
  projectId: string,
  shotId: string,
  options: VideoCreateShotGenerationSubmitOptions,
) {
  configure();
  const { data } = await generateVideoCreateShot({
    path: { projectId, shotId },
    body: options,
    headers: { ...authHeaders(), "Idempotency-Key": randomUuid() },
    throwOnError: true,
  });
  if (!data) throw new Error("分镜视频任务提交失败");
  return data;
}

export async function batchGenerateVideoCreateShotVideos(projectId: string, options: VideoCreateShotGenerationOptions) {
  configure();
  const { data } = await batchGenerateVideoCreateShots({
    path: { projectId },
    body: options,
    headers: { ...authHeaders(), "Idempotency-Key": randomUuid() },
    throwOnError: true,
  });
  if (!data) throw new Error("批量生成分镜任务提交失败");
  return data;
}

export async function replaceVideoCreateShotVideo(
  projectId: string,
  shotId: string,
  assetId: string,
  source: "library_replacement" | "upload_replacement",
) {
  configure();
  const { data } = await replaceVideoCreateShot({
    path: { projectId, shotId },
    body: { assetId, source },
    headers: authHeaders(),
    throwOnError: true,
  });
  if (!data) throw new Error("替代视频保存失败");
  return data;
}

export async function fetchVideoCreateShotMaterialVersions(projectId: string, shotId: string) {
  configure();
  const { data } = await listVideoCreateShotMaterialVersions({
    path: { projectId, shotId },
    headers: authHeaders(),
    throwOnError: true,
  });
  if (!data) throw new Error("素材生成历史加载失败");
  return data.versions;
}

export async function applyVideoCreateShotMaterialVersion(projectId: string, shotId: string, versionId: string) {
  configure();
  const { data } = await applyVideoCreateShotMaterialVersionRequest({
    path: { projectId, shotId, versionId },
    headers: authHeaders(),
    throwOnError: true,
  });
  if (!data) throw new Error("素材历史版本应用失败");
  return data;
}

export async function processVideoCreateShotVideo(
  projectId: string,
  shotId: string,
  action: "audio-replace" | "subtitle-compose",
) {
  configure();
  const { data } = await processVideoCreateShotMaterial({
    path: { projectId, shotId, action },
    headers: { ...authHeaders(), "Idempotency-Key": randomUuid() },
    throwOnError: true,
  });
  if (!data) throw new Error(action === "audio-replace" ? "配音替换任务提交失败" : "字幕合成任务提交失败");
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

export async function updateAllVideoCreateShotOptions(
  projectId: string,
  options: { audioEnabled?: boolean; subtitleEnabled?: boolean },
) {
  configure();
  const { data } = await updateAllVideoCreateShotSettings({
    path: { projectId },
    body: options,
    headers: authHeaders(),
    throwOnError: true,
  });
  if (!data) throw new Error("分镜批量设置保存失败");
  return data;
}

export async function saveVideoCreateMediaSettings(
  projectId: string,
  settings: Pick<VideoCreateInput, "voiceSettings" | "subtitleStyleId">,
) {
  configure();
  const { data } = await updateVideoCreateMediaSettingsRequest({
    path: { projectId },
    body: settings,
    headers: authHeaders(),
    throwOnError: true,
  });
  if (!data) throw new Error("媒体设置保存失败");
  return data;
}

export async function previewVideoCreatePresetVoice(
  voiceSettings: NonNullable<VideoCreateInput["voiceSettings"]>,
  text = "让每一次表达，都更自然、更有感染力。",
) {
  configure();
  const { data } = await previewVideoCreateVoiceRequest({
    body: { voiceSettings, text },
    headers: authHeaders(),
    throwOnError: true,
  });
  if (!data) throw new Error("音色试听失败");
  return data;
}

export async function batchGenerateVideoCreateVoices(projectId: string) {
  configure();
  const { data } = await batchGenerateVideoCreateAudioRequest({
    path: { projectId },
    headers: { ...authHeaders(), "Idempotency-Key": randomUuid() },
    throwOnError: true,
  });
  if (!data) throw new Error("批量生成配音任务提交失败");
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
export async function fetchAdScriptProjects(): Promise<AdScriptProject[]> {
  configure();
  const { data } = await listAdScriptProjects({ headers: authHeaders(), throwOnError: true });
  if (!data) throw new Error("口播脚本生成记录加载失败");
  return data.projects;
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
  await downloadAttachment({
    kind: "ad-script",
    projectId: input.projectId,
    variantId: input.variantId,
    versionId: input.versionId,
    format: input.format,
  });
}
export async function submitJob(
  moduleId: ModuleId,
  title: string,
  values: Record<string, string>,
  videoModel?: SeedanceModelId,
  idempotencyKey = randomUuid(),
  options: { allowMockFallback?: boolean } = {},
) {
  configure();
  const { data } = await createJob({
    path: { moduleId },
    body: { title, values, videoModel, allowMockFallback: options.allowMockFallback ?? true },
    headers: { ...authHeaders(), "Idempotency-Key": idempotencyKey },
    throwOnError: true,
  });
  if (!data) throw new Error("任务创建失败");
  return data;
}
export async function submitAiGenerateJob(body: CreateAiGenerateJobData["body"], idempotencyKey = randomUuid()) {
  configure();
  try {
    const { data } = await createAiGenerateJobRequest({
      body,
      headers: { ...authHeaders(), "Idempotency-Key": idempotencyKey },
      throwOnError: true,
    });
    if (!data) throw new Error("AI 创作任务创建失败");
    return data;
  } catch (reason) {
    const message =
      reason && typeof reason === "object" && "error" in reason
        ? (reason as { error?: { message?: string } }).error?.message
        : undefined;
    throw new Error(message || (reason instanceof Error ? reason.message : "AI 创作任务创建失败"));
  }
}

export async function fetchMediaUnderstandCapabilities() {
  configure();
  const { data } = await getMediaUnderstandCapabilities({
    headers: authHeaders(),
    cache: "no-store",
    throwOnError: true,
  });
  if (!data) throw new Error("素材理解模型加载失败");
  return data;
}

export async function submitMediaUnderstandJob(
  body: Omit<CreateMediaUnderstandJobData["body"], "idempotencyKey">,
  idempotencyKey = randomUuid(),
) {
  configure();
  try {
    const { data } = await createMediaUnderstandJobRequest({
      body: { ...body, idempotencyKey },
      headers: authHeaders(),
      throwOnError: true,
    });
    if (!data) throw new Error("素材理解任务创建失败");
    return data;
  } catch (reason) {
    const message =
      reason && typeof reason === "object" && "error" in reason
        ? (reason as { error?: { message?: string } }).error?.message
        : undefined;
    throw new Error(message || (reason instanceof Error ? reason.message : "素材理解任务创建失败"));
  }
}

export async function checkQwenVoiceSample(assetId: string) {
  configure();
  try {
    const { data } = await preflightQwenVoiceSampleRequest({
      body: { assetId },
      headers: authHeaders(),
      throwOnError: true,
    });
    if (!data) throw new Error("录音预检失败");
    return data;
  } catch (reason) {
    const message =
      reason && typeof reason === "object" && "error" in reason
        ? (reason as { error?: { message?: string } }).error?.message
        : undefined;
    throw new Error(message || (reason instanceof Error ? reason.message : "录音预检失败"));
  }
}
export async function fetchCreationCapabilities() {
  const response = await fetch(apiUrl("/api/creation/capabilities"));
  if (!response.ok) throw new Error("创作模型目录加载失败");
  return response.json() as Promise<{
    models: GetCreationCapabilitiesResponse["models"];
  }>;
}
export async function uploadMediaFile(file: File, folderId?: string, onProgress?: (percent: number) => void) {
  return uploadLibraryAsset(file, "media", file.name.replace(/\.[^.]+$/, ""), "", folderId, onProgress);
}
export async function fetchLibraryAssets(kind: Exclude<AssetKind, "product">, folderId?: string) {
  const params = new URLSearchParams({ kind });
  if (folderId) params.set("folderId", folderId);
  const response = await fetch(apiUrl(`/api/assets?${params}`), { headers: authHeaders() });
  if (!response.ok) throw new Error("资产列表加载失败");
  const data = (await response.json()) as { assets: LibraryAsset[] };
  return data.assets;
}
export async function fetchCustomPortraits() {
  configure();
  const { data } = await listCustomPortraits({ headers: authHeaders(), throwOnError: true });
  return data?.portraits ?? [];
}
export async function createCustomPortrait(file: File, displayName: string, gender: PortraitGender, description = "") {
  const asset = await uploadLibraryAsset(file, "portrait", displayName, description);
  configure();
  const { data } = await registerCustomPortrait({
    body: { assetId: asset.id, gender },
    headers: authHeaders(),
    throwOnError: true,
  });
  if (!data) throw new Error("自建虚拟人像创建失败");
  return data.portrait;
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
export interface ProductLinkPreview { id: string; title: string; images: Array<{ id: string; name: string; mimeType: string; size: number; url: string }> }
export async function previewProductLink(url: string) {
  const response = await fetch(apiUrl("/api/products/link-preview"), { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
  const data = (await response.json().catch(() => null)) as { preview?: ProductLinkPreview; error?: { message?: string } } | null;
  if (!response.ok || !data?.preview) throw new Error(data?.error?.message || "商品链接抓取失败");
  return data.preview;
}
export async function downloadProductPreviewImage(image: ProductLinkPreview["images"][number]) {
  const response = await fetch(apiUrl(image.url), { headers: authHeaders() }); const type = response.headers.get("content-type")?.split(";", 1)[0] ?? "";
  if (!response.ok || !["image/jpeg", "image/png", "image/webp"].includes(type)) throw new Error("商品预览图片无法读取");
  return new File([await response.blob()], image.name, { type });
}
export async function uploadProduct(input: {
  files: File[];
  name: string;
  description: string;
  sharingScope: LibraryProduct["sharingScope"];
  onProgress?: (percent: number) => void;
}) {
  const body = new FormData();
  input.files.forEach((file) => {
    body.append("files", file);
  });
  body.set("productName", input.name);
  body.set("description", input.description);
  body.set("sharingScope", input.sharingScope);
  const data = await postFormDataWithProgress<{
    product?: LibraryProduct;
    error?: { message?: string };
  }>("/api/products", body, input.onProgress, "商品上传失败");
  if (!data.product) throw new Error(data.error?.message || "商品上传失败");
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
  workflowKind?: "video" | "script";
  mode?: "product" | "talking";
  product: {
    id: number | string | null;
    productName: string;
    productImages: RemixMaterialFile[];
    productFormMetaList: unknown[] | null;
    productFormDesc: string | null;
  };
  demand: string;
  scriptContent?: string;
  rawMaterialFiles: RemixMaterialFile[];
  voiceAsset?: RemixMaterialFile | null;
  portraitAssets: Array<{
    id?: number | string | null;
    reference?: { type: "general"; portraitId: number } | { type: "custom"; assetId: string };
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
export async function fetchRemixProjects(input: {
  query?: string;
  stage?: RemixProjectSummary["currentStage"];
  page: number;
  pageSize: number;
}) {
  configure();
  const { data } = await listVideoRemixProjects({ query: input, headers: authHeaders(), throwOnError: true });
  if (!data) throw new Error("项目记录加载失败");
  return data;
}
export async function fetchRemixProject(projectId: string) {
  configure();
  const { data } = await getVideoRemixProject({ path: { projectId }, headers: authHeaders(), throwOnError: true });
  if (!data) throw new Error("项目详情加载失败");
  return data;
}
export async function saveRemixProject(
  projectId: string,
  input: {
    title?: string;
    workspace?: RemixProjectDetail["workspace"];
  },
) {
  configure();
  const { data } = await updateVideoRemixProject({
    path: { projectId },
    body: input,
    headers: authHeaders(),
    throwOnError: true,
  });
  if (!data) throw new Error("项目保存失败");
  return data;
}
export async function composeRemixVideos(
  input: { sourceJobId: string; sources: Array<{ sourceAssetId: string; selectedAssetId: string }> },
  idempotencyKey = randomUuid(),
) {
  configure();
  const { data } = await createVideoRemixComposeJob({
    body: input,
    headers: { ...authHeaders(), "Idempotency-Key": idempotencyKey },
    throwOnError: true,
  });
  if (!data) throw new Error("合并任务创建失败");
  return data;
}
export async function generateRemixShot(
  input: {
    sourceJobId: string;
    sourceAssetId: string;
    prompt: string;
    modelId: SeedanceModelId;
    ratio: string;
    resolution: string;
    duration: number;
    references: Array<{ assetId: string; label: string }>;
    portraitReferences: Array<{ reference: PortraitReference; label: string }>;
  },
  idempotencyKey = randomUuid(),
) {
  configure();
  const { data } = await createVideoRemixShotGenerationJob({
    body: input,
    headers: { ...authHeaders(), "Idempotency-Key": idempotencyKey },
    throwOnError: true,
  });
  if (!data) throw new Error("分镜生成任务创建失败");
  return data;
}
export async function fetchRemixShotJobs(sourceJobId: string) {
  configure();
  const { data } = await listVideoRemixShotGenerationJobs({
    path: { sourceJobId },
    headers: authHeaders(),
    throwOnError: true,
  });
  return data?.jobs ?? [];
}
export async function runRemixPromptTool(
  input: {
    sourceJobId: string;
    sourceAssetId: string;
    prompt: string;
    tool: RemixPromptTool;
    config: RemixPromptToolConfig;
  },
  idempotencyKey = randomUuid(),
) {
  configure();
  const { data } = await createVideoRemixPromptToolJob({
    body: input,
    headers: { ...authHeaders(), "Idempotency-Key": idempotencyKey },
    throwOnError: true,
  });
  if (!data) throw new Error("提示词工具任务创建失败");
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
  const data = await postFormDataWithProgress<{ asset: LibraryAsset & { displayName?: string } }>(
    "/api/uploads",
    body,
    onProgress,
    "资产上传失败",
  );
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

function postFormDataWithProgress<T>(
  path: string,
  body: FormData,
  onProgress: ((percent: number) => void) | undefined,
  fallbackMessage: string,
) {
  return new Promise<T>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", apiUrl(path));
    for (const [name, value] of Object.entries(authHeaders())) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };
    request.onerror = () => reject(new Error(`${fallbackMessage}，请检查网络连接`));
    request.onabort = () => reject(new Error(`${fallbackMessage}，上传已取消`));
    request.onload = () => {
      let data: (T & { error?: { message?: string } }) | undefined;
      try {
        data = JSON.parse(request.responseText) as T & { error?: { message?: string } };
      } catch {
        data = undefined;
      }
      if (request.status >= 200 && request.status < 300 && data) {
        onProgress?.(100);
        resolve(data);
      } else {
        reject(new Error(data?.error?.message || fallbackMessage));
      }
    };
    request.send(body);
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
export async function fetchToolOutputFolder(moduleId: string) {
  const response = await fetch(apiUrl(`/api/tool-output-folders/${moduleId}`), { headers: authHeaders() });
  const data = (await response.json().catch(() => null)) as {
    folder?: AssetFolder | null;
    error?: { message?: string };
  } | null;
  if (!response.ok || !data) throw new Error(data?.error?.message || "任务默认文件夹加载失败");
  return data.folder ?? null;
}
export async function setToolOutputFolder(moduleId: string, folderId: string) {
  const response = await fetch(apiUrl(`/api/tool-output-folders/${moduleId}`), {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(folderId ? { folderId } : {}),
  });
  const data = (await response.json().catch(() => null)) as {
    folder?: AssetFolder | null;
    error?: { message?: string };
  } | null;
  if (!response.ok || !data) throw new Error(data?.error?.message || "任务默认文件夹设置失败");
  return data.folder ?? null;
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

export function mediaAccessUrl(url: string) {
  const assetMatch = /^\/api\/assets\/([0-9a-f-]{36})\/access$/i.exec(url);
  if (assetMatch?.[1]) return url;
  const artifactMatch = /^\/api\/artifacts\/([0-9a-f-]{36})\/access$/i.exec(url);
  return artifactMatch?.[1] ? url : undefined;
}

export function isPublicMediaUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.origin === "https://files.xbeaconai.com";
  } catch {
    return false;
  }
}

export function directMediaSource(url: string) {
  return isPublicMediaUrl(url) ? url : undefined;
}

export async function resolveMediaCdnUrl(url: string, original = false) {
  const direct = directMediaSource(url);
  if (direct) return direct;
  const accessUrl = mediaAccessUrl(url);
  if (!accessUrl) throw new Error("媒体文件未提供 CDN 地址");
  const response = await fetch(apiUrl(accessUrl), { headers: authHeaders() });
  if (!response.ok) throw new Error("媒体文件 CDN 发布失败");
  const data = (await response.json()) as { url?: string; originalUrl?: string };
  const resolved = original ? data.originalUrl : data.url;
  if (!resolved || !isPublicMediaUrl(resolved)) throw new Error("媒体接口未返回受信任的 CDN 地址");
  return resolved;
}

export function downloadDirectUrl(url: string, name: string) {
  if (!isPublicMediaUrl(url)) throw new Error("媒体文件未使用受信任的 CDN 地址");
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
}

export async function downloadAttachment(resource: DownloadResource) {
  configure();
  const { data } = await createDownloadTicket({
    body: resource,
    headers: authHeaders(),
    throwOnError: true,
  });
  if (!data) throw new Error("无法创建下载地址");
  const link = document.createElement("a");
  link.href = apiUrl(data.url);
  document.body.append(link);
  link.click();
  link.remove();
}

export async function downloadAuthenticated(url: string, name: string) {
  if (isPublicMediaUrl(url)) {
    downloadDirectUrl(url, name);
    return;
  }
  const artifactMatch = /^\/api\/artifacts\/([0-9a-f-]{36})\/access$/i.exec(url);
  try {
    const resolved = await resolveMediaCdnUrl(url, true);
    downloadDirectUrl(resolved, name);
    return;
  } catch (error) {
    if (artifactMatch?.[1]) {
      await downloadAttachment({ kind: "artifact", artifactId: artifactMatch[1] });
      return;
    }
    throw error;
  }
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
