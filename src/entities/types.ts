export type TaskStatus =
  | "draft"
  | "validating"
  | "uploading"
  | "queued"
  | "processing"
  | "succeeded"
  | "partially_succeeded"
  | "failed"
  | "cancelled";
export type ModuleId =
  | "video-remix"
  | "video-create"
  | "ad-script"
  | "ai-generate"
  | "video-cut"
  | "media-understand"
  | "video-mashup"
  | "voice-clone"
  | "video-renewal"
  | "subtitle-erase"
  | "video-enhancement"
  | "kickart";
export interface MockTask {
  id: string;
  moduleId: ModuleId;
  title: string;
  status: TaskStatus;
  progress: number;
  createdAt: number;
  updatedAt: number;
  failedStage?: string;
  message?: string;
  result?: string;
}
export type TaskEvent =
  | { type: "SUBMIT" }
  | { type: "VALID" }
  | { type: "UPLOADED" }
  | { type: "START" }
  | { type: "PROGRESS"; progress: number }
  | { type: "SUCCEED" }
  | { type: "PARTIAL" }
  | { type: "FAIL"; stage: string; message: string }
  | { type: "CANCEL" }
  | { type: "RETRY" };

export interface ApiArtifact {
  id: string;
  name: string;
  mimeType: string;
  url?: string;
  text?: string;
  executionMode: "real" | "local" | "mock" | "mixed";
  lineage: Array<{
    id: string;
    capability: string;
    executionMode: "real" | "local" | "mock";
    implementation: string;
    fallbackReason?: string;
  }>;
}

export interface ApiJobResult {
  kind: string;
  title: string;
  summary: string;
  artifacts: ApiArtifact[];
  data?: Record<string, unknown>;
}

export type AssetKind = "media" | "product" | "portrait" | "voice";
export interface LibraryAsset {
  id: string;
  name: string;
  originalName: string;
  mimeType: string;
  size: number;
  kind: AssetKind;
  description?: string;
  url: string;
  createdAt: string;
}
export interface LibraryProduct {
  id: string;
  name: string;
  description?: string;
  sharingScope: "private" | "team" | "organization";
  images: LibraryAsset[];
  createdAt: string;
}
