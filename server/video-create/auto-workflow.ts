import type { AccountStore } from "../accounts/account-store";
import type { SqliteJobStore } from "../jobs/sqlite-job-store";
import type { CustomPortraitStore } from "../portraits/custom-portrait-store";
import type { JobRecord } from "../types";
import {
  type EnqueueVideoCreateOperationInput,
  enqueueVideoCreateOperation,
  type VideoCreateQueue,
} from "./job-service";
import { resolveVideoCreateShotGenerationDraft } from "./shot-generation-draft";
import { videoCreateBatchEligibleShots, type VideoCreateStore } from "./video-create-store";

interface VideoCreateAutoWorkflowDependencies {
  store: SqliteJobStore;
  videoCreates: VideoCreateStore;
  accounts: AccountStore;
  customPortraits: CustomPortraitStore;
  queue: VideoCreateQueue;
}

function workflowError(message: string): JobRecord["error"] {
  return {
    code: "AUTO_GENERATE_BLOCKED",
    message,
    retryable: false,
    requestId: crypto.randomUUID(),
  };
}

export async function advanceVideoCreateAutoWorkflow(
  dependencies: VideoCreateAutoWorkflowDependencies,
  projectId: string,
  completedJob?: JobRecord,
) {
  let aggregate = dependencies.videoCreates.get(projectId);
  if (!aggregate?.project.autoGenerate) return undefined;
  if (completedJob?.status === "failed" || completedJob?.status === "cancelled") {
    dependencies.videoCreates.setProject(projectId, { autoGenerate: false });
    return undefined;
  }
  const runId = aggregate.project.autoGenerateRunId;
  if (!runId) {
    dependencies.videoCreates.setProject(projectId, {
      autoGenerate: false,
      status: "failed",
      error: workflowError("一键生成流程缺少运行标识，请重新提交"),
    });
    return undefined;
  }
  const ownerUserId = aggregate.project.ownerUserId;
  const enqueue = (input: Omit<EnqueueVideoCreateOperationInput, "ownerUserId" | "projectId">) =>
    enqueueVideoCreateOperation(dependencies, {
      ...input,
      ownerUserId,
      projectId,
    });
  if (aggregate.project.status === "completed" && aggregate.project.finalArtifactId) {
    dependencies.videoCreates.setProject(projectId, { autoGenerate: false });
    return undefined;
  }
  if (["analyzing", "script_generating", "storyboard_generating", "composing"].includes(aggregate.project.status))
    return undefined;
  if (
    aggregate.shots.some((shot) => shot.status === "queued" || shot.status === "generating" || shot.materialProcessing)
  )
    return undefined;
  if (!aggregate.sections.length && !aggregate.project.recommendation)
    return enqueue({ operation: "analyze", idempotencyKey: `${runId}:analyze` });
  if (!aggregate.sections.length) return enqueue({ operation: "script", idempotencyKey: `${runId}:script` });
  if (!aggregate.shots.length) return enqueue({ operation: "storyboard", idempotencyKey: `${runId}:storyboard` });

  const shots = videoCreateBatchEligibleShots(aggregate.shots);
  if (shots.length) {
    const jobs: JobRecord[] = [];
    for (const shot of shots) {
      const draft = resolveVideoCreateShotGenerationDraft({
        projectId,
        shotId: shot.id,
        ownerUserId: aggregate.project.ownerUserId,
        videoCreates: dependencies.videoCreates,
        accounts: dependencies.accounts,
        customPortraits: dependencies.customPortraits,
      });
      if (!draft) {
        dependencies.videoCreates.setProject(projectId, {
          autoGenerate: false,
          status: "failed",
          error: workflowError(`第 ${shot.ordinal} 个分镜缺少可用的生成参数`),
        });
        return undefined;
      }
      const portrait = draft.attachments.find((attachment) => attachment.source === "portrait");
      jobs.push(
        await enqueue({
          operation: "shot",
          shotId: shot.id,
          shotOptions: {
            videoModel: aggregate.project.input.videoModel,
            ratio: aggregate.project.input.ratio,
            resolution: "720p",
            generateAudio: true,
            prompt: draft.prompt,
            duration: draft.duration,
            referenceMode: draft.referenceMode,
            references: draft.attachments.flatMap((attachment) =>
              attachment.source === "asset" && attachment.assetId
                ? [{ assetId: attachment.assetId, label: attachment.label, category: attachment.category }]
                : [],
            ),
            portrait: portrait?.portraitReference
              ? { reference: portrait.portraitReference, label: portrait.label, category: "人物" }
              : null,
          },
          idempotencyKey: `${runId}:shot:${shot.id}`,
        }),
      );
    }
    return jobs;
  }

  aggregate = dependencies.videoCreates.get(projectId);
  if (aggregate?.canCompose) return enqueue({ operation: "compose", idempotencyKey: `${runId}:compose` });
  dependencies.videoCreates.setProject(projectId, {
    autoGenerate: false,
    status: "failed",
    error: workflowError("部分分镜素材尚未就绪，请检查失败项后重试"),
  });
  return undefined;
}
