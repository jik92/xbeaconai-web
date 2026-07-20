import type { ModuleId } from "../../../web/entities/types";

export type JobOutputKind = "video" | "audio" | "image" | "text";

export interface JobDefinition {
  readonly moduleId: ModuleId;
  readonly stages: Array<[capability: string, label: string]>;
  readonly summary: string;
  outputKind(values: Record<string, string>): JobOutputKind;
}
