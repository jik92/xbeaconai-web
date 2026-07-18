import { modules } from "./routes";
import type { ModuleId } from "@/entities/types";

export interface UiFeatureEntry {
  id: string;
  moduleId: ModuleId;
  feature: string;
  action: string;
  apiOperationId: string;
  e2eCaseId: string;
  requiresUpload: boolean;
}

const shared = (moduleId: ModuleId, action: string, apiOperationId: string): UiFeatureEntry => ({
  id:`${moduleId}:${action}`, moduleId, feature:"workflow", action, apiOperationId,
  e2eCaseId:`${moduleId}-all-actions`, requiresUpload:false,
});

export const uiFeatureRegistry: UiFeatureEntry[] = modules.flatMap((module) => {
  if (module.id === "video-remix") return [
    shared(module.id,"upload-source","uploadMedia"), shared(module.id,"switch-product-mode","localState"), shared(module.id,"switch-talking-mode","localState"),
    shared(module.id,"edit-requirement","localState"), shared(module.id,"start-analysis","createJob"), shared(module.id,"show-history","listJobs"), shared(module.id,"new-project","localState"),
    shared(module.id,"select-product","localState"), shared(module.id,"refresh-analysis","createJob"), shared(module.id,"compare-version","localState"), shared(module.id,"smart-check","localState"),
    shared(module.id,"smart-modify","localState"), shared(module.id,"change-voice","localState"), shared(module.id,"edit-prompt","localState"), shared(module.id,"copy-prompt","clipboard"),
    shared(module.id,"adjust-all-shots","localState"), shared(module.id,"edit-shot","localState"), shared(module.id,"preview-merge","getJob"), shared(module.id,"merge-result","getJob"),
    shared(module.id,"select-video-model","getModels"),shared(module.id,"wizard-back","localState"), shared(module.id,"wizard-next","localState"),
    ...module.result.actions.map((action)=>shared(module.id,action,action.includes("导出")?"artifactDownload":"resultAction")),
  ].map((item,index)=>({...item,requiresUpload:index===0||item.action==="start-analysis"}));
  const fields = module.fields.map((field):UiFeatureEntry=>({
    id:`${module.id}:field:${field.id}`,moduleId:module.id,feature:`field:${field.kind}`,action:`set-${field.id}`,
    apiOperationId:["video","audio","image"].includes(field.kind)?"uploadMedia":"localState",e2eCaseId:`${module.id}-complete-workflow`,requiresUpload:["video","audio","image"].includes(field.kind),
  }));
  return [
    ...fields,
    shared(module.id,"wizard-next","localState"),shared(module.id,"wizard-back","localState"),shared(module.id,"edit-config","localState"),shared(module.id,"advanced-settings","localState"),
    shared(module.id,"submit-job","createJob"),shared(module.id,"cancel-job","cancelJob"),shared(module.id,"retry-job","retryJob"),shared(module.id,"view-result","getJob"),shared(module.id,"export-row","getJob"),
    ...module.result.actions.map((action):UiFeatureEntry=>({id:`${module.id}:result:${action}`,moduleId:module.id,feature:`result:${module.result.kind}`,action,apiOperationId:action.includes("下载")||action.includes("导出")?"artifactDownload":"resultAction",e2eCaseId:`${module.id}-result-actions`,requiresUpload:false})),
    ...(module.id==="ai-generate"?[shared(module.id,"open-asset-library","localState"),shared(module.id,"select-video-model","getModels")]:[]),
  ];
});

export function auditUiFeatureRegistry() {
  const ids = new Set<string>();
  for (const entry of uiFeatureRegistry) {
    if (ids.has(entry.id)) throw new Error(`Duplicate UI feature id: ${entry.id}`);
    ids.add(entry.id);
    if (!entry.apiOperationId || !entry.e2eCaseId) throw new Error(`Incomplete UI feature: ${entry.id}`);
  }
  for (const module of modules) {
    if (!uiFeatureRegistry.some((entry) => entry.moduleId === module.id)) throw new Error(`Missing UI feature coverage: ${module.id}`);
    for (const action of module.result.actions) if (!uiFeatureRegistry.some((entry) => entry.moduleId === module.id && entry.action === action)) throw new Error(`Missing result action: ${module.id}/${action}`);
  }
  return uiFeatureRegistry;
}
