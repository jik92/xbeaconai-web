import { randomUuid } from "@/lib/random-id";

export type GenerateKind = "video" | "image";
export type GenerateModel = "seedance-2.0" | "seedance-2.0-mini" | "seedance-2.0-fast" | "seedream-4.0";
export type ReferenceKind = "image" | "video" | "audio";
export type GenerateReference = {
  id: string;
  name: string;
  kind: ReferenceKind;
  mimeType: string;
  size: number;
  url: string;
};
export type GenerateResult = {
  id: string;
  kind: GenerateKind;
  title: string;
  prompt: string;
  createdAt: string;
  model: GenerateModel;
  ratio: string;
  resolution: string;
  duration: number;
  count: number;
  favorite: boolean;
  variant: number;
  status: "generating" | "completed" | "interrupted";
  progress: number;
  references: string[];
};
export type GenerateConversation = { id: string; title: string; createdAt: string; results: GenerateResult[] };
export type GenerateSnapshot = {
  conversations: GenerateConversation[];
  activeId: string;
  prompt: string;
  references: GenerateReference[];
  kind: GenerateKind;
  model: GenerateModel;
  referenceMode: "omni";
  ratio: string;
  resolution: string;
  duration: number;
  count: number;
  seed: string;
  manualConfirm: boolean;
  expanded: boolean;
  version: number;
};

export const videoModels = [
  { id: "seedance-2.0", name: "字节Seedance 2.0", description: "多模态全能参考，适合高质量视频创作", badge: "推荐" },
  { id: "seedance-2.0-mini", name: "字节Seedance 2.0 Mini", description: "更轻量、更快速的通用视频生成模型" },
  { id: "seedance-2.0-fast", name: "字节Seedance 2.0 Fast", description: "极速 Mock 预览，适合快速验证创意" },
] as const;
export const imageModels = [
  { id: "seedream-4.0", name: "字节Seedream 4.0", description: "高质量图片生成与参考图编辑", badge: "图片" },
] as const;

const now = () => new Date().toISOString();
function referenceKind(file: File): ReferenceKind | undefined {
  return file.type.startsWith("image/")
    ? "image"
    : file.type.startsWith("video/")
      ? "video"
      : file.type.startsWith("audio/")
        ? "audio"
        : undefined;
}
export function validateGenerateReferences(current: GenerateReference[], files: File[], kind: GenerateKind) {
  if (current.length + files.length > 6) return "最多添加 6 个参考素材";
  const next = [...current];
  for (const file of files) {
    const type = referenceKind(file);
    if (!type) return "仅支持图片、视频或音频";
    if (file.size > 500 * 1024 * 1024) return "单个素材不能超过 500MB";
    if (kind === "video" && next.some((item) => item.kind === type))
      return `视频生成每类最多添加 1 个${type === "image" ? "图片" : type === "video" ? "视频" : "音频"}参考`;
    next.push({ id: "", name: file.name, kind: type, mimeType: file.type, size: file.size, url: "" });
  }
  return undefined;
}

export class AiGenerateMockStore {
  private listeners = new Set<() => void>();
  private timers = new Map<string, ReturnType<typeof setTimeout>[]>();
  private state: GenerateSnapshot;
  constructor() {
    const id = randomUuid();
    this.state = {
      conversations: [{ id, title: "默认创作", createdAt: now(), results: [] }],
      activeId: id,
      prompt: "",
      references: [],
      kind: "video",
      model: "seedance-2.0",
      referenceMode: "omni",
      ratio: "9:16",
      resolution: "720P",
      duration: 5,
      count: 1,
      seed: "",
      manualConfirm: false,
      expanded: false,
      version: 0,
    };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(patch: Partial<GenerateSnapshot>) {
    this.state = { ...this.state, ...patch, version: this.state.version + 1 };
    for (const listener of this.listeners) listener();
  }
  setPrompt(prompt: string) {
    this.update({ prompt });
  }
  setExpanded(expanded: boolean) {
    this.update({ expanded });
  }
  setManualConfirm(manualConfirm: boolean) {
    this.update({ manualConfirm });
  }
  setRatio(ratio: string) {
    this.update({ ratio });
  }
  setResolution(resolution: string) {
    this.update({ resolution });
  }
  setDuration(duration: number) {
    this.update({ duration });
  }
  setCount(count: number) {
    this.update({ count });
  }
  setSeed(seed: string) {
    this.update({ seed });
  }
  setKind(kind: GenerateKind) {
    this.update({
      kind,
      model: kind === "video" ? "seedance-2.0" : "seedream-4.0",
      resolution: kind === "video" ? "720P" : "2K",
      references: [],
    });
  }
  setModel(model: GenerateModel) {
    this.update({ model });
  }
  selectConversation(activeId: string) {
    if (this.state.conversations.some((item) => item.id === activeId)) this.update({ activeId });
  }
  newConversation() {
    this.revokeReferences();
    const id = randomUuid();
    this.update({
      conversations: [{ id, title: "默认创作", createdAt: now(), results: [] }, ...this.state.conversations],
      activeId: id,
      prompt: "",
      references: [],
      expanded: false,
    });
    return id;
  }
  addFiles(files: File[]) {
    const error = validateGenerateReferences(this.state.references, files, this.state.kind);
    if (error) return error;
    const references = files.map((file) => ({
      id: randomUuid(),
      name: file.name,
      kind: referenceKind(file)!,
      mimeType: file.type,
      size: file.size,
      url: URL.createObjectURL(file),
    }));
    this.update({ references: [...this.state.references, ...references] });
    return undefined;
  }
  addAssets(assets: Array<{ id: string; name: string; mimeType: string; size?: number; url?: string }>) {
    if (this.state.references.length + assets.length > 6) return "最多添加 6 个参考素材";
    const references = [...this.state.references];
    for (const asset of assets) {
      const kind = asset.mimeType.startsWith("image/")
        ? "image"
        : asset.mimeType.startsWith("video/")
          ? "video"
          : asset.mimeType.startsWith("audio/")
            ? "audio"
            : undefined;
      if (!kind) return "仅支持图片、视频或音频";
      if (this.state.kind === "video" && references.some((item) => item.kind === kind))
        return `视频生成每类最多添加 1 个${kind === "image" ? "图片" : kind === "video" ? "视频" : "音频"}参考`;
      references.push({
        id: asset.id,
        name: asset.name,
        kind,
        mimeType: asset.mimeType,
        size: asset.size ?? 0,
        url: asset.url ?? "",
      });
    }
    this.update({ references });
    return undefined;
  }
  removeReference(id: string) {
    const ref = this.state.references.find((item) => item.id === id);
    if (ref) URL.revokeObjectURL(ref.url);
    this.update({ references: this.state.references.filter((item) => item.id !== id) });
  }
  private revokeReferences() {
    for (const ref of this.state.references) URL.revokeObjectURL(ref.url);
  }
  submit() {
    const prompt = this.state.prompt.trim();
    if (!prompt) return false;
    const conversationId = this.state.activeId,
      id = randomUuid(),
      referenceNames = this.state.references.map((item) => item.name),
      createdAt = now(),
      result: GenerateResult = {
        id,
        kind: this.state.kind,
        title: prompt.slice(0, 20),
        prompt,
        createdAt,
        model: this.state.model,
        ratio: this.state.ratio,
        resolution: this.state.resolution,
        duration: this.state.duration,
        count: this.state.count,
        favorite: false,
        variant: 1,
        status: "generating",
        progress: 12,
        references: referenceNames,
      };
    this.revokeReferences();
    const conversations = this.state.conversations.map((item) =>
      item.id === conversationId
        ? { ...item, title: item.results.length ? item.title : prompt.slice(0, 18), results: [...item.results, result] }
        : item,
    );
    this.update({ conversations, prompt: "", references: [], expanded: false });
    const scheduled = [45, 78, 100].map((progress, index) =>
      setTimeout(
        () => {
          const conversations = this.state.conversations.map((item) =>
            item.id === conversationId
              ? {
                  ...item,
                  results: item.results.map((entry) =>
                    entry.id === id
                      ? {
                          ...entry,
                          progress,
                          status: progress === 100 ? ("completed" as const) : ("generating" as const),
                        }
                      : entry,
                  ),
                }
              : item,
          );
          this.update({ conversations });
          if (progress === 100) this.timers.delete(id);
        },
        300 * (index + 1),
      ),
    );
    this.timers.set(id, scheduled);
    return true;
  }
  continueFrom(resultId: string) {
    const result = this.active().results.find((item) => item.id === resultId);
    if (result) this.update({ prompt: `继续优化：${result.prompt}`, expanded: false });
  }
  createVariant(resultId: string) {
    const result = this.active().results.find((item) => item.id === resultId);
    if (!result) return;
    const variant = {
      ...result,
      id: randomUuid(),
      title: `${result.title} · 变体 ${result.variant + 1}`,
      createdAt: now(),
      variant: result.variant + 1,
      favorite: false,
      status: "completed" as const,
      progress: 100,
    };
    this.update({
      conversations: this.state.conversations.map((item) =>
        item.id === this.state.activeId ? { ...item, results: [...item.results, variant] } : item,
      ),
    });
  }
  toggleFavorite(resultId: string) {
    this.update({
      conversations: this.state.conversations.map((item) => ({
        ...item,
        results: item.results.map((result) =>
          result.id === resultId ? { ...result, favorite: !result.favorite } : result,
        ),
      })),
    });
  }
  active() {
    return this.state.conversations.find((item) => item.id === this.state.activeId)!;
  }
  dispose() {
    for (const timers of this.timers.values()) for (const timer of timers) clearTimeout(timer);
    this.timers.clear();
    this.revokeReferences();
    this.state = {
      ...this.state,
      references: [],
      conversations: this.state.conversations.map((item) => ({
        ...item,
        results: item.results.map((result) =>
          result.status === "generating" ? { ...result, status: "interrupted", progress: result.progress } : result,
        ),
      })),
    };
  }
}
