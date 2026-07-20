import { and, asc, desc, eq, max } from "drizzle-orm";
import { type AppDatabase, openDatabase } from "../db/database";
import {
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
import { VIDEO_CREATE_TEXT_MODEL } from "./types";

type ProjectRow = typeof videoCreateProjects.$inferSelect;
type SectionRow = typeof videoCreateScriptSections.$inferSelect;
type VersionRow = typeof videoCreateScriptVersions.$inferSelect;
type ShotRow = typeof videoCreateShots.$inferSelect;

export interface VideoCreateAggregate {
  project: ProjectRow;
  sections: Array<SectionRow & { versions: VersionRow[]; currentVersion?: VersionRow }>;
  shots: ShotRow[];
  canCompose: boolean;
}

export class VideoCreateVersionConflictError extends Error {}
export class VideoCreateStateError extends Error {}

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
    const normalized = {
      ...recommendation,
      segmentCount: Math.max(recommendation.segmentCount, Math.ceil(recommendation.durationSec / 15)),
    };
    const input = { ...aggregate.project.input, ...normalized };
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
    if (!aggregate || aggregate.sections.length !== storyboard.shots.length)
      throw new VideoCreateStateError("分镜数量必须与脚本段落数量一致");
    const timestamp = new Date().toISOString();
    this.db.transaction(
      (tx) => {
        tx.delete(videoCreateShots).where(eq(videoCreateShots.projectId, projectId)).run();
        tx.insert(videoCreateShots)
          .values(
            storyboard.shots.map((shot, index) => ({
              id: crypto.randomUUID(),
              projectId,
              scriptSectionId: aggregate.sections[index].id,
              ordinal: index + 1,
              prompt: shot.prompt,
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
        "status" | "jobId" | "videoAssetId" | "attempts" | "error" | "prompt" | "audioEnabled" | "subtitleEnabled"
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
    return {
      project,
      sections: enriched,
      shots,
      canCompose:
        Boolean(shots.length) && shots.every((shot) => shot.status === "succeeded" || shot.status === "replaced"),
    };
  }
}

export function videoCreateJobValues(input: {
  operation: "analyze" | "script" | "regenerate-section" | "storyboard" | "shot" | "compose";
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
