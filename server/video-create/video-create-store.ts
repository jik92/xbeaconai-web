import { and, asc, desc, eq, max } from "drizzle-orm";
import { type AppDatabase, openDatabase } from "../db/database";
import {
  videoCreateMaterialVersions,
  videoCreateProjects,
  videoCreateScriptSections,
  videoCreateScriptVersions,
  videoCreateShots,
} from "../db/schema";
import { env } from "../env";
import type { JobRecord } from "../types";
import type {
  VideoCreateGeneratedScript,
  VideoCreateGeneratedStoryboard,
  VideoCreateInput,
  VideoCreateProjectStatus,
  VideoCreateRecommendation,
  VideoCreateShotStatus,
} from "./types";
import { VIDEO_CREATE_TEXT_MODEL, VideoCreateInputSchema, VideoCreateRecommendationSchema } from "./types";

type ProjectRow = typeof videoCreateProjects.$inferSelect;
type SectionRow = typeof videoCreateScriptSections.$inferSelect;
type VersionRow = typeof videoCreateScriptVersions.$inferSelect;
type ShotRow = typeof videoCreateShots.$inferSelect;
type MaterialVersionRow = typeof videoCreateMaterialVersions.$inferSelect;

export interface VideoCreateAggregate {
  project: ProjectRow;
  sections: Array<SectionRow & { versions: VersionRow[]; currentVersion?: VersionRow }>;
  shots: Array<ShotRow & { materialProcessing: boolean }>;
  canCompose: boolean;
}

export class VideoCreateVersionConflictError extends Error {}
export class VideoCreateStateError extends Error {}
export class VideoCreateMaterialBusyError extends Error {}

export function videoCreateBatchEligibleShots<
  T extends { status: VideoCreateShotStatus; materialProcessing?: boolean },
>(shots: T[]) {
  return shots.filter((shot) => !shot.materialProcessing && (shot.status === "pending" || shot.status === "failed"));
}

export function videoCreateMinimumStoryboardCount(durationSec: number) {
  return Math.ceil(durationSec / 15);
}

export function videoCreateShotNarration(aggregate: VideoCreateAggregate, shot: ShotRow) {
  const savedNarration = shot.narration.trim();
  if (savedNarration) return savedNarration;
  return aggregate.sections.find((section) => section.id === shot.scriptSectionId)?.currentVersion?.text.trim() ?? "";
}

export class VideoCreateStore {
  readonly db: AppDatabase;
  private readonly client: ReturnType<typeof openDatabase>["client"];

  constructor(path = env.databasePath) {
    const connection = openDatabase(path);
    this.client = connection.client;
    this.db = connection.db;
  }

  close() {
    this.client.close();
  }

  createDraft(input: {
    id: string;
    ownerUserId: string;
    title: string;
    projectInput: VideoCreateInput;
    idempotencyKey?: string;
  }) {
    if (input.idempotencyKey) {
      const existing = this.db
        .select()
        .from(videoCreateProjects)
        .where(
          and(
            eq(videoCreateProjects.ownerUserId, input.ownerUserId),
            eq(videoCreateProjects.idempotencyKey, input.idempotencyKey),
          ),
        )
        .get();
      if (existing) return this.aggregate(existing);
    }
    const timestamp = new Date().toISOString();
    this.db
      .insert(videoCreateProjects)
      .values({
        id: input.id,
        ownerUserId: input.ownerUserId,
        title: input.title,
        input: input.projectInput,
        idempotencyKey: input.idempotencyKey,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    const created = this.getOwned(input.id, input.ownerUserId);
    if (!created) throw new Error("VIDEO_CREATE_PROJECT_CREATE_FAILED");
    return created;
  }

  getOwned(projectId: string, ownerUserId: string) {
    const project = this.db
      .select()
      .from(videoCreateProjects)
      .where(and(eq(videoCreateProjects.id, projectId), eq(videoCreateProjects.ownerUserId, ownerUserId)))
      .get();
    return project ? this.aggregate(project) : undefined;
  }

  getByJobId(jobId: string) {
    const project = this.db.select().from(videoCreateProjects).where(eq(videoCreateProjects.currentJobId, jobId)).get();
    return project ? this.aggregate(project) : undefined;
  }

  get(projectId: string) {
    const project = this.db.select().from(videoCreateProjects).where(eq(videoCreateProjects.id, projectId)).get();
    return project ? this.aggregate(project) : undefined;
  }

  listOwned(ownerUserId: string) {
    return this.db
      .select()
      .from(videoCreateProjects)
      .where(eq(videoCreateProjects.ownerUserId, ownerUserId))
      .orderBy(desc(videoCreateProjects.updatedAt))
      .limit(50)
      .all()
      .map((project) => this.aggregate(project));
  }

  updateInput(projectId: string, ownerUserId: string, expectedVersion: number, input: VideoCreateInput) {
    const project = this.getOwned(projectId, ownerUserId)?.project;
    if (!project) return undefined;
    if (project.version !== expectedVersion)
      throw new VideoCreateVersionConflictError("项目已被其他页面修改，请刷新后重试");
    if (!["draft", "script_review", "failed"].includes(project.status))
      throw new VideoCreateStateError("当前阶段不能修改项目参数");
    this.db
      .update(videoCreateProjects)
      .set({ input, version: project.version + 1, updatedAt: new Date().toISOString() })
      .where(and(eq(videoCreateProjects.id, projectId), eq(videoCreateProjects.version, expectedVersion)))
      .run();
    return this.getOwned(projectId, ownerUserId);
  }

  setProject(
    projectId: string,
    patch: Partial<
      Pick<ProjectRow, "status" | "recommendation" | "currentJobId" | "finalArtifactId" | "error" | "title" | "input">
    >,
  ) {
    this.db
      .update(videoCreateProjects)
      .set({ ...patch, updatedAt: new Date().toISOString() })
      .where(eq(videoCreateProjects.id, projectId))
      .run();
    return this.get(projectId);
  }

  setRecommendation(projectId: string, recommendation: VideoCreateRecommendation) {
    const aggregate = this.get(projectId);
    if (!aggregate) return undefined;
    const normalized = recommendation;
    const input: VideoCreateInput = {
      productAssetIds: aggregate.project.input.productAssetIds,
      portraitId: aggregate.project.input.portraitId,
      voiceAssetId: aggregate.project.input.voiceAssetId,
      videoModel: aggregate.project.input.videoModel,
      ratio: aggregate.project.input.ratio,
      subtitles: aggregate.project.input.subtitles,
      priority: aggregate.project.input.priority,
      ...normalized,
    };
    this.db
      .update(videoCreateProjects)
      .set({
        recommendation: normalized,
        input,
        status: "draft",
        version: aggregate.project.version + 1,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(videoCreateProjects.id, projectId))
      .run();
    return this.get(projectId);
  }

  replaceScripts(projectId: string, generated: VideoCreateGeneratedScript) {
    const timestamp = new Date().toISOString();
    this.db.transaction(
      (tx) => {
        const sectionIds = tx
          .select({ id: videoCreateScriptSections.id })
          .from(videoCreateScriptSections)
          .where(eq(videoCreateScriptSections.projectId, projectId))
          .all()
          .map((item) => item.id);
        tx.delete(videoCreateShots).where(eq(videoCreateShots.projectId, projectId)).run();
        for (const sectionId of sectionIds)
          tx.delete(videoCreateScriptVersions).where(eq(videoCreateScriptVersions.sectionId, sectionId)).run();
        tx.delete(videoCreateScriptSections).where(eq(videoCreateScriptSections.projectId, projectId)).run();
        for (const [index, section] of generated.sections.entries()) {
          const sectionId = crypto.randomUUID();
          const versionId = crypto.randomUUID();
          tx.insert(videoCreateScriptSections)
            .values({
              id: sectionId,
              projectId,
              ordinal: index + 1,
              label: section.label,
              currentVersionId: versionId,
              createdAt: timestamp,
              updatedAt: timestamp,
            })
            .run();
          tx.insert(videoCreateScriptVersions)
            .values({
              id: versionId,
              sectionId,
              sequence: 1,
              source: "generated",
              text: section.text,
              durationSec: section.durationSec,
              model: VIDEO_CREATE_TEXT_MODEL,
              createdAt: timestamp,
            })
            .run();
        }
        tx.update(videoCreateProjects)
          .set({ status: "script_review", error: null, version: videoCreateProjects.version, updatedAt: timestamp })
          .where(eq(videoCreateProjects.id, projectId))
          .run();
      },
      { behavior: "immediate" },
    );
    return this.get(projectId);
  }

  clearScripts(projectId: string, ownerUserId: string) {
    if (!this.getOwned(projectId, ownerUserId)) return undefined;
    const runningProjectStatuses: VideoCreateProjectStatus[] = [
      "analyzing",
      "script_generating",
      "storyboard_generating",
      "composing",
    ];
    const timestamp = new Date().toISOString();
    this.db.transaction(
      (tx) => {
        const project = tx
          .select()
          .from(videoCreateProjects)
          .where(and(eq(videoCreateProjects.id, projectId), eq(videoCreateProjects.ownerUserId, ownerUserId)))
          .get();
        const hasRunningShot = tx
          .select({ status: videoCreateShots.status })
          .from(videoCreateShots)
          .where(eq(videoCreateShots.projectId, projectId))
          .all()
          .some((shot) => shot.status === "queued" || shot.status === "generating");
        const hasRunningMaterial = tx
          .select({ status: videoCreateMaterialVersions.status })
          .from(videoCreateMaterialVersions)
          .where(eq(videoCreateMaterialVersions.projectId, projectId))
          .all()
          .some((version) => version.status === "pending");
        if (!project || runningProjectStatuses.includes(project.status) || hasRunningShot || hasRunningMaterial)
          throw new VideoCreateStateError("项目仍有任务执行中，暂时不能清除脚本");
        const sectionIds = tx
          .select({ id: videoCreateScriptSections.id })
          .from(videoCreateScriptSections)
          .where(eq(videoCreateScriptSections.projectId, projectId))
          .all()
          .map((item) => item.id);
        tx.delete(videoCreateShots).where(eq(videoCreateShots.projectId, projectId)).run();
        for (const sectionId of sectionIds)
          tx.delete(videoCreateScriptVersions).where(eq(videoCreateScriptVersions.sectionId, sectionId)).run();
        tx.delete(videoCreateScriptSections).where(eq(videoCreateScriptSections.projectId, projectId)).run();
        tx.update(videoCreateProjects)
          .set({
            status: "draft",
            currentJobId: null,
            finalArtifactId: null,
            error: null,
            version: project.version + 1,
            updatedAt: timestamp,
          })
          .where(and(eq(videoCreateProjects.id, projectId), eq(videoCreateProjects.ownerUserId, ownerUserId)))
          .run();
      },
      { behavior: "immediate" },
    );
    return this.getOwned(projectId, ownerUserId);
  }

  appendScriptVersion(input: {
    projectId: string;
    sectionId: string;
    expectedVersionId: string;
    text: string;
    durationSec: number;
    source: "regenerated" | "human";
  }) {
    return this.db.transaction(
      (tx) => {
        const section = tx
          .select()
          .from(videoCreateScriptSections)
          .where(
            and(
              eq(videoCreateScriptSections.id, input.sectionId),
              eq(videoCreateScriptSections.projectId, input.projectId),
            ),
          )
          .get();
        if (!section) return undefined;
        if (section.currentVersionId !== input.expectedVersionId)
          throw new VideoCreateVersionConflictError("脚本已产生新版本，请刷新后再保存");
        const sequence =
          (tx
            .select({ value: max(videoCreateScriptVersions.sequence) })
            .from(videoCreateScriptVersions)
            .where(eq(videoCreateScriptVersions.sectionId, input.sectionId))
            .get()?.value ?? 0) + 1;
        const version: typeof videoCreateScriptVersions.$inferInsert = {
          id: crypto.randomUUID(),
          sectionId: input.sectionId,
          sequence,
          source: input.source,
          parentVersionId: input.expectedVersionId,
          text: input.text,
          durationSec: input.durationSec,
          model: input.source === "human" ? "human" : VIDEO_CREATE_TEXT_MODEL,
          createdAt: new Date().toISOString(),
        };
        tx.insert(videoCreateScriptVersions).values(version).run();
        tx.update(videoCreateScriptSections)
          .set({ currentVersionId: version.id, updatedAt: version.createdAt })
          .where(eq(videoCreateScriptSections.id, input.sectionId))
          .run();
        tx.update(videoCreateProjects)
          .set({ version: videoCreateProjects.version, updatedAt: version.createdAt })
          .where(eq(videoCreateProjects.id, input.projectId))
          .run();
        return version;
      },
      { behavior: "immediate" },
    );
  }

  replaceShots(projectId: string, storyboard: VideoCreateGeneratedStoryboard) {
    const aggregate = this.get(projectId);
    if (!aggregate?.sections.length) throw new VideoCreateStateError("请先生成并确认脚本");
    if (aggregate.project.input.segmentCount !== storyboard.shots.length)
      throw new VideoCreateStateError("分镜数量必须与设置的分镜段数一致");
    const timestamp = new Date().toISOString();
    this.db.transaction(
      (tx) => {
        tx.delete(videoCreateShots).where(eq(videoCreateShots.projectId, projectId)).run();
        tx.insert(videoCreateShots)
          .values(
            storyboard.shots.map((shot, index) => ({
              id: crypto.randomUUID(),
              projectId,
              scriptSectionId:
                aggregate.sections[
                  Math.min(
                    aggregate.sections.length - 1,
                    Math.floor((index * aggregate.sections.length) / storyboard.shots.length),
                  )
                ].id,
              ordinal: index + 1,
              prompt: shot.prompt,
              narration: shot.narration,
              generationPlan: shot.generationPlan,
              durationSec: shot.durationSec,
              status: "pending" as const,
              createdAt: timestamp,
              updatedAt: timestamp,
            })),
          )
          .run();
        tx.update(videoCreateProjects)
          .set({ status: "storyboard_review", error: null, updatedAt: timestamp })
          .where(eq(videoCreateProjects.id, projectId))
          .run();
      },
      { behavior: "immediate" },
    );
    return this.get(projectId);
  }

  updateShot(
    shotId: string,
    patch: Partial<
      Pick<
        ShotRow,
        | "status"
        | "jobId"
        | "videoAssetId"
        | "currentMaterialVersionId"
        | "audioArtifactId"
        | "subtitleCues"
        | "attempts"
        | "error"
        | "prompt"
        | "narration"
        | "generationPlan"
        | "audioEnabled"
        | "subtitleEnabled"
      >
    >,
  ) {
    this.db
      .update(videoCreateShots)
      .set({ ...patch, updatedAt: new Date().toISOString() })
      .where(eq(videoCreateShots.id, shotId))
      .run();
    return this.db.select().from(videoCreateShots).where(eq(videoCreateShots.id, shotId)).get();
  }

  listMaterialVersions(projectId: string, shotId: string, ownerUserId: string) {
    if (!this.getOwnedShot(projectId, shotId, ownerUserId)) return undefined;
    return this.db
      .select()
      .from(videoCreateMaterialVersions)
      .where(and(eq(videoCreateMaterialVersions.projectId, projectId), eq(videoCreateMaterialVersions.shotId, shotId)))
      .orderBy(desc(videoCreateMaterialVersions.createdAt))
      .limit(100)
      .all();
  }

  getMaterialVersion(projectId: string, shotId: string, versionId: string) {
    return this.db
      .select()
      .from(videoCreateMaterialVersions)
      .where(
        and(
          eq(videoCreateMaterialVersions.id, versionId),
          eq(videoCreateMaterialVersions.projectId, projectId),
          eq(videoCreateMaterialVersions.shotId, shotId),
        ),
      )
      .get();
  }

  getMaterialVersionByJobId(jobId: string) {
    return this.db.select().from(videoCreateMaterialVersions).where(eq(videoCreateMaterialVersions.jobId, jobId)).get();
  }

  createPendingMaterialVersion(input: {
    id?: string;
    projectId: string;
    shotId: string;
    source: MaterialVersionRow["source"];
    inputVersionId?: string | null;
    jobId: string;
  }) {
    const timestamp = new Date().toISOString();
    const version: typeof videoCreateMaterialVersions.$inferInsert = {
      id: input.id ?? crypto.randomUUID(),
      projectId: input.projectId,
      shotId: input.shotId,
      source: input.source,
      status: "pending",
      inputVersionId: input.inputVersionId,
      jobId: input.jobId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.db.insert(videoCreateMaterialVersions).values(version).run();
    return version;
  }

  createAndApplyMaterialVersion(input: {
    projectId: string;
    shotId: string;
    source: MaterialVersionRow["source"];
    storageKind: NonNullable<MaterialVersionRow["storageKind"]>;
    contentId: string;
    inputVersionId?: string | null;
    jobId?: string | null;
    status?: Extract<VideoCreateShotStatus, "succeeded" | "replaced">;
  }) {
    const timestamp = new Date().toISOString();
    return this.db.transaction(
      (tx) => {
        const version: typeof videoCreateMaterialVersions.$inferInsert = {
          id: crypto.randomUUID(),
          projectId: input.projectId,
          shotId: input.shotId,
          source: input.source,
          status: "succeeded",
          storageKind: input.storageKind,
          contentId: input.contentId,
          inputVersionId: input.inputVersionId,
          jobId: input.jobId,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        tx.insert(videoCreateMaterialVersions).values(version).run();
        tx.update(videoCreateShots)
          .set({
            currentMaterialVersionId: version.id,
            videoAssetId: input.contentId,
            status: input.status ?? (input.storageKind === "asset" ? "replaced" : "succeeded"),
            jobId: input.jobId,
            error: null,
            updatedAt: timestamp,
          })
          .where(and(eq(videoCreateShots.id, input.shotId), eq(videoCreateShots.projectId, input.projectId)))
          .run();
        return version;
      },
      { behavior: "immediate" },
    );
  }

  completePendingMaterialVersion(input: {
    jobId: string;
    storageKind: NonNullable<MaterialVersionRow["storageKind"]>;
    contentId: string;
  }) {
    const timestamp = new Date().toISOString();
    return this.db.transaction(
      (tx) => {
        const version = tx
          .select()
          .from(videoCreateMaterialVersions)
          .where(eq(videoCreateMaterialVersions.jobId, input.jobId))
          .get();
        if (!version) throw new Error("VIDEO_CREATE_MATERIAL_VERSION_NOT_FOUND");
        tx.update(videoCreateMaterialVersions)
          .set({
            status: "succeeded",
            storageKind: input.storageKind,
            contentId: input.contentId,
            error: null,
            updatedAt: timestamp,
          })
          .where(eq(videoCreateMaterialVersions.id, version.id))
          .run();
        tx.update(videoCreateShots)
          .set({
            currentMaterialVersionId: version.id,
            videoAssetId: input.contentId,
            status:
              version.source === "library_replacement" || version.source === "upload_replacement"
                ? "replaced"
                : "succeeded",
            jobId: input.jobId,
            error: null,
            updatedAt: timestamp,
          })
          .where(eq(videoCreateShots.id, version.shotId))
          .run();
        return { ...version, status: "succeeded" as const, ...input, updatedAt: timestamp };
      },
      { behavior: "immediate" },
    );
  }

  failPendingMaterialVersion(jobId: string, error: JobRecord["error"], previousShotStatus?: VideoCreateShotStatus) {
    const timestamp = new Date().toISOString();
    return this.db.transaction(
      (tx) => {
        const version = tx
          .select()
          .from(videoCreateMaterialVersions)
          .where(eq(videoCreateMaterialVersions.jobId, jobId))
          .get();
        if (!version) return undefined;
        tx.update(videoCreateMaterialVersions)
          .set({ status: "failed", error, updatedAt: timestamp })
          .where(eq(videoCreateMaterialVersions.id, version.id))
          .run();
        tx.update(videoCreateShots)
          .set({
            status: previousShotStatus ?? "failed",
            error,
            updatedAt: timestamp,
          })
          .where(eq(videoCreateShots.id, version.shotId))
          .run();
        return version;
      },
      { behavior: "immediate" },
    );
  }

  applyMaterialVersion(projectId: string, shotId: string, versionId: string, ownerUserId: string) {
    const shot = this.getOwnedShot(projectId, shotId, ownerUserId);
    const version = this.getMaterialVersion(projectId, shotId, versionId);
    if (!shot || !version) return undefined;
    if (shot.status === "queued" || shot.status === "generating" || shot.materialProcessing)
      throw new VideoCreateMaterialBusyError("当前分镜仍有任务执行中");
    if (version.status !== "succeeded" || !version.contentId || !version.storageKind)
      throw new VideoCreateStateError("只有内容可用的成功版本可以应用");
    this.updateShot(shotId, {
      currentMaterialVersionId: version.id,
      videoAssetId: version.contentId,
      status: version.storageKind === "asset" ? "replaced" : "succeeded",
      error: null,
    });
    return this.getOwned(projectId, ownerUserId);
  }

  updateAllShotSettings(projectId: string, patch: Partial<Pick<ShotRow, "audioEnabled" | "subtitleEnabled">>) {
    this.db
      .update(videoCreateShots)
      .set({ ...patch, updatedAt: new Date().toISOString() })
      .where(eq(videoCreateShots.projectId, projectId))
      .run();
    return this.get(projectId);
  }

  getOwnedShot(projectId: string, shotId: string, ownerUserId: string) {
    const aggregate = this.getOwned(projectId, ownerUserId);
    return aggregate?.shots.find((shot) => shot.id === shotId);
  }

  markAllShots(projectId: string, status: VideoCreateShotStatus, jobId?: string) {
    this.db
      .update(videoCreateShots)
      .set({ status, jobId, updatedAt: new Date().toISOString() })
      .where(eq(videoCreateShots.projectId, projectId))
      .run();
  }

  private aggregate(project: ProjectRow): VideoCreateAggregate {
    const normalizedProject: ProjectRow = {
      ...project,
      input: VideoCreateInputSchema.parse(project.input),
      recommendation: project.recommendation
        ? VideoCreateRecommendationSchema.parse(project.recommendation)
        : project.recommendation,
    };
    const sections = this.db
      .select()
      .from(videoCreateScriptSections)
      .where(eq(videoCreateScriptSections.projectId, project.id))
      .orderBy(asc(videoCreateScriptSections.ordinal))
      .all();
    const enriched = sections.map((section) => {
      const versions = this.db
        .select()
        .from(videoCreateScriptVersions)
        .where(eq(videoCreateScriptVersions.sectionId, section.id))
        .orderBy(asc(videoCreateScriptVersions.sequence))
        .all();
      return {
        ...section,
        versions,
        currentVersion: versions.find((version) => version.id === section.currentVersionId),
      };
    });
    const shots = this.db
      .select()
      .from(videoCreateShots)
      .where(eq(videoCreateShots.projectId, project.id))
      .orderBy(asc(videoCreateShots.ordinal))
      .all();
    const materialVersions = this.db
      .select()
      .from(videoCreateMaterialVersions)
      .where(eq(videoCreateMaterialVersions.projectId, project.id))
      .all();
    const resolvedShots = shots.map((shot) => ({
      ...shot,
      materialProcessing: materialVersions.some(
        (version) => version.shotId === shot.id && version.status === "pending",
      ),
      narration:
        shot.narration.trim() ||
        enriched.find((section) => section.id === shot.scriptSectionId)?.currentVersion?.text.trim() ||
        "",
    }));
    return {
      project: normalizedProject,
      sections: enriched,
      shots: resolvedShots,
      canCompose:
        Boolean(resolvedShots.length) &&
        resolvedShots.every(
          (shot) =>
            (shot.status === "succeeded" || shot.status === "replaced") &&
            !shot.materialProcessing &&
            (!shot.audioEnabled || Boolean(shot.audioArtifactId)) &&
            (!shot.subtitleEnabled || shot.subtitleCues.length > 0),
        ),
    };
  }
}

export function videoCreateJobValues(input: {
  operation:
    | "analyze"
    | "script"
    | "regenerate-section"
    | "storyboard"
    | "shot"
    | "audio-replace"
    | "subtitle-compose"
    | "compose";
  projectId: string;
  sectionId?: string;
  shotId?: string;
  expectedVersionId?: string;
}): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).filter((item): item is [string, string] => typeof item[1] === "string"),
  );
}

export function nextVideoCreateStatus(operation: string): VideoCreateProjectStatus {
  if (operation === "analyze") return "analyzing";
  if (operation === "script" || operation === "regenerate-section") return "script_generating";
  if (operation === "storyboard") return "storyboard_generating";
  if (operation === "compose") return "composing";
  return "storyboard_review";
}

export function videoCreateError(error: unknown): JobRecord["error"] {
  return {
    code:
      error instanceof VideoCreateVersionConflictError
        ? "VERSION_CONFLICT"
        : error instanceof VideoCreateStateError
          ? "INVALID_STATE"
          : "VIDEO_CREATE_FAILED",
    message: error instanceof Error ? error.message : "一键成片任务失败",
    retryable: !(error instanceof VideoCreateVersionConflictError || error instanceof VideoCreateStateError),
    requestId: crypto.randomUUID(),
  };
}
