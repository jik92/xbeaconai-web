// biome-ignore-all lint/a11y/noStaticElementInteractions: The backdrop dismisses the attachment dialog.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronRight,
  FileAudio2,
  FileImage,
  FileVideo2,
  Folder,
  FolderOpen,
  Search,
  Upload,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { deleteLibraryAsset, fetchAssetFolders, fetchLibraryAssets, uploadMediaFile } from "@/api/api-client";
import { Button } from "@/components/ui/button";
import type { AssetFolder, LibraryAsset } from "@/entities/types";
import { AuthenticatedMedia } from "./authenticated-media";
import { FileUpload } from "./file-upload";

export interface AttachmentSelection {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  durationSec?: number;
  url?: string;
  originalUrl?: string;
  source: "library" | "upload";
}

type AttachmentMediaKind = "image" | "video";

export type AttachmentPickerConstraints = {
  summary: string[];
  byKind?: Partial<Record<AttachmentMediaKind, { maxBytes?: number; maxDurationSec?: number; maxCount?: number }>>;
};

function attachmentMediaKind(mimeType: string): AttachmentMediaKind | undefined {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return undefined;
}

function constraintReason(
  asset: Pick<LibraryAsset, "mimeType" | "size" | "durationSec">,
  constraints?: AttachmentPickerConstraints,
) {
  const kind = attachmentMediaKind(asset.mimeType);
  const rule = kind ? constraints?.byKind?.[kind] : undefined;
  if (!rule) return undefined;
  if (rule.maxBytes && asset.size > rule.maxBytes) return `素材大小超过限制（最多 ${formatBytes(rule.maxBytes)}）`;
  if (rule.maxDurationSec && asset.durationSec !== undefined && asset.durationSec > rule.maxDurationSec)
    return `视频时长不能超过 ${rule.maxDurationSec} 秒（当前 ${asset.durationSec.toFixed(2)} 秒）`;
  return undefined;
}

function accepts(asset: LibraryAsset, accept: string) {
  if (!accept || accept === "*/*") return true;
  return accept.split(",").some((raw) => {
    const rule = raw.trim();
    if (rule.endsWith("/*")) return asset.mimeType.startsWith(rule.slice(0, -1));
    return rule === asset.mimeType;
  });
}

function acceptsMediaType(accept: string, mediaType: "image" | "video") {
  if (!accept || accept === "*/*") return true;
  return accept.split(",").some((raw) => {
    const rule = raw.trim();
    return rule === `${mediaType}/*` || rule.startsWith(`${mediaType}/`);
  });
}

function AssetIcon({ mimeType }: { mimeType: string }) {
  if (mimeType.startsWith("image/")) return <FileImage />;
  if (mimeType.startsWith("audio/")) return <FileAudio2 />;
  return <FileVideo2 />;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function formatDuration(seconds: number | undefined) {
  if (seconds === undefined) return undefined;
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

export function AttachmentPicker({
  accept = "image/*,video/*,audio/*",
  multiple = false,
  initialSource = "library",
  showMediaTypeFilters = false,
  constraints,
  trigger,
  onSelect,
}: {
  accept?: string;
  multiple?: boolean;
  initialSource?: "library" | "upload";
  showMediaTypeFilters?: boolean;
  constraints?: AttachmentPickerConstraints;
  trigger: (open: () => void) => ReactNode;
  onSelect: (assets: AttachmentSelection[]) => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<"library" | "upload">("library");
  const [mediaFilter, setMediaFilter] = useState<"image" | "video">("image");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [previewId, setPreviewId] = useState("");
  const [folderId, setFolderId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<AttachmentSelection[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState("");
  const { data: folders = [], isLoading: foldersLoading } = useQuery({
    queryKey: ["asset-folders"],
    queryFn: fetchAssetFolders,
    enabled: open,
  });
  useEffect(() => {
    if (!open || !folders.length) return;
    if (!folderId || !folders.some((folder) => folder.id === folderId))
      setFolderId(folders.find((folder) => !folder.parentId)?.id ?? folders[0].id);
  }, [folderId, folders, open]);
  const { data = [], isLoading } = useQuery({
    queryKey: ["asset-library", "media", folderId],
    queryFn: () => fetchLibraryAssets("media", folderId),
    enabled: open && Boolean(folderId),
  });
  const orderedFolders = useMemo(() => {
    const ordered: Array<{ folder: AssetFolder; depth: number }> = [];
    const visit = (parentId: string | undefined, depth: number) => {
      for (const folder of folders.filter((item) => item.parentId === parentId)) {
        ordered.push({ folder, depth });
        visit(folder.id, depth + 1);
      }
    };
    visit(undefined, 0);
    return ordered;
  }, [folders]);
  const currentFolder = folders.find((folder) => folder.id === folderId);
  const childFolders = folders.filter((folder) => folder.parentId === folderId);
  const breadcrumbs = useMemo(() => {
    const result: AssetFolder[] = [];
    let current = folders.find((folder) => folder.id === folderId);
    const visited = new Set<string>();
    while (current && !visited.has(current.id)) {
      result.unshift(current);
      visited.add(current.id);
      current = current.parentId ? folders.find((folder) => folder.id === current?.parentId) : undefined;
    }
    return result;
  }, [folderId, folders]);
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return data.filter(
      (asset) =>
        accepts(asset, accept) &&
        (!keyword || `${asset.name} ${asset.originalName} ${asset.description ?? ""}`.toLowerCase().includes(keyword)),
    );
  }, [accept, data, query]);
  const availableMediaFilters = (["image", "video"] as const).filter((kind) => acceptsMediaType(accept, kind));
  const effectiveMediaFilter = availableMediaFilters.includes(mediaFilter)
    ? mediaFilter
    : (availableMediaFilters[0] ?? "image");
  const filteredByMediaType = useMemo(
    () => filtered.filter((asset) => asset.mimeType.startsWith(`${effectiveMediaFilter}/`)),
    [effectiveMediaFilter, filtered],
  );
  const mediaFilters = [
    { id: "image", label: "图片" },
    { id: "video", label: "视频" },
  ] as const;
  const canFilterMediaTypes =
    showMediaTypeFilters && acceptsMediaType(accept, "image") && acceptsMediaType(accept, "video");
  const previewAsset = data.find((asset) => asset.id === previewId);
  const close = () => {
    setOpen(false);
    setMediaFilter("image");
    setSelected([]);
    setPreviewId("");
    setUploadFiles([]);
    setUploadedFiles([]);
    setUploadProgress(0);
    setError("");
  };
  const chooseLibrary = () => {
    const assets = selected
      .map((id) => data.find((asset) => asset.id === id))
      .filter((asset): asset is LibraryAsset => Boolean(asset))
      .map((asset) => ({
        id: asset.id,
        name: asset.name,
        mimeType: asset.mimeType,
        size: asset.size,
        durationSec: asset.durationSec,
        url: asset.url,
        originalUrl: asset.originalUrl,
        source: "library" as const,
      }));
    if (!assets.length) return;
    onSelect(assets);
    close();
  };
  const upload = async (files: File[], retainedUploads: AttachmentSelection[] = []) => {
    if (!files.length) return;
    const candidateFiles = multiple ? files : files.slice(0, 1);
    const rejected = candidateFiles.find((file) =>
      constraintReason({ mimeType: file.type, size: file.size, durationSec: undefined }, constraints),
    );
    if (rejected) {
      setError(
        constraintReason({ mimeType: rejected.type, size: rejected.size, durationSec: undefined }, constraints) ??
          "文件不符合引用要求",
      );
      return;
    }
    const pendingFiles = candidateFiles;
    const totalBytes = pendingFiles.reduce((total, file) => total + Math.max(file.size, 1), 0);
    const fileProgress = pendingFiles.map(() => 0);
    setUploadFiles(pendingFiles);
    setUploadedFiles(retainedUploads);
    setUploadProgress(0);
    setUploading(true);
    setError("");
    try {
      const results = await Promise.all(
        pendingFiles.map(async (file, index): Promise<{ file: File; asset?: LibraryAsset; error?: string }> => {
          try {
            const asset = await uploadMediaFile(file, folderId || undefined, (progress) => {
              fileProgress[index] = progress;
              const weightedProgress = fileProgress.reduce(
                (total, current, currentIndex) => total + current * Math.max(pendingFiles[currentIndex]?.size ?? 0, 1),
                0,
              );
              setUploadProgress(Math.round(weightedProgress / totalBytes));
            });
            const rejection = constraintReason(asset, constraints);
            if (rejection) {
              await deleteLibraryAsset(asset.id);
              return { file, error: rejection };
            }
            return { file, asset };
          } catch (reason) {
            return { file, error: reason instanceof Error ? reason.message : "附件上传失败" };
          }
        }),
      );
      const selections = results.flatMap((result) =>
        result.asset
          ? [
              {
                id: result.asset.id,
                name: result.file.name,
                mimeType: result.asset.mimeType,
                size: result.asset.size,
                durationSec: result.asset.durationSec,
                url: result.asset.url,
                originalUrl: result.asset.originalUrl,
                source: "upload" as const,
              },
            ]
          : [],
      );
      const failed = results.filter((result) => result.error);
      setUploadProgress(100);
      setUploadFiles(failed.map((result) => result.file));
      setUploadedFiles([...retainedUploads, ...selections]);
      if (failed.length) setError(failed[0]?.error ?? `${failed.length} 个文件上传失败`);
      void queryClient.invalidateQueries({ queryKey: ["asset-library", "media"] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "附件上传失败");
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      {trigger(() => {
        setSource(initialSource);
        setMediaFilter("image");
        setOpen(true);
      })}
      {open &&
        createPortal(
          <div className="attachment-picker-layer" role="presentation" onMouseDown={close}>
            <section
              className={`attachment-picker-dialog ${source === "library" && previewAsset ? "has-preview" : ""}`}
              role="dialog"
              aria-modal="true"
              aria-label="选择附件"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <header>
                <h2 className="type-section-title text-ink">选择附件</h2>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭" onClick={close}>
                  <X />
                </Button>
              </header>
              <div className="attachment-source-tabs">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={source === "library" ? "active" : ""}
                  onClick={() => setSource("library")}
                >
                  <FolderOpen /> 从素材库选择
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={source === "upload" ? "active" : ""}
                  onClick={() => setSource("upload")}
                >
                  <Upload /> 从本地上传
                </Button>
              </div>
              {constraints?.summary.length ? (
                <div
                  className="mx-4 mb-3 rounded-lg border border-line bg-surface-muted px-3 py-2"
                  aria-label="素材规则"
                >
                  <b className="type-label text-ink">素材规则</b>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    {constraints.summary.map((item) => (
                      <span className="type-helper text-muted" key={item}>
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {source === "library" ? (
                <div className="attachment-library-panel">
                  <div className={`attachment-directory-layout ${previewAsset ? "has-preview" : ""}`}>
                    <aside className="attachment-folder-tree">
                      <b>全部文件夹</b>
                      <nav>
                        {orderedFolders.map(({ folder, depth }) => (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            key={folder.id}
                            className={folder.id === folderId ? "active" : ""}
                            style={{ paddingLeft: `${10 + depth * 16}px` }}
                            onClick={() => {
                              setFolderId(folder.id);
                              setSelected([]);
                              setPreviewId("");
                            }}
                          >
                            {folder.id === folderId ? <FolderOpen /> : <Folder />}
                            <span>{folder.name}</span>
                          </Button>
                        ))}
                      </nav>
                    </aside>
                    <section className="attachment-folder-files">
                      <div className="attachment-library-toolbar">
                        <label className="attachment-search">
                          <Search />
                          <input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="搜索当前文件夹…"
                          />
                        </label>
                        {canFilterMediaTypes && (
                          <div className="attachment-media-filters" aria-label="筛选素材类型">
                            {mediaFilters.map((filter) => (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                key={filter.id}
                                className={effectiveMediaFilter === filter.id ? "active" : ""}
                                onClick={() => setMediaFilter(filter.id)}
                              >
                                {filter.label}
                              </Button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="attachment-breadcrumbs">
                        {breadcrumbs.map((folder, index) => (
                          <span key={folder.id}>
                            {index > 0 && <ChevronRight />}
                            <Button type="button" variant="ghost" size="sm" onClick={() => setFolderId(folder.id)}>
                              {folder.name}
                            </Button>
                          </span>
                        ))}
                      </div>
                      <div className="attachment-grid">
                        {!query.trim() &&
                          childFolders.map((folder) => (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              key={folder.id}
                              className="attachment-folder-card"
                              onClick={() => {
                                setFolderId(folder.id);
                                setSelected([]);
                                setPreviewId("");
                              }}
                            >
                              <i>
                                <Folder />
                              </i>
                              <span>
                                <b>{folder.name}</b>
                                <small className="type-helper">文件夹</small>
                              </span>
                              <ChevronRight />
                            </Button>
                          ))}
                        {filteredByMediaType.map((asset) => {
                          const active = selected.includes(asset.id);
                          const reason = constraintReason(asset, constraints);
                          return (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              key={asset.id}
                              className={active ? "active" : ""}
                              disabled={Boolean(reason)}
                              title={reason}
                              onClick={() => {
                                setPreviewId(asset.id);
                                setSelected((current) =>
                                  active
                                    ? current.filter((id) => id !== asset.id)
                                    : multiple
                                      ? [...current, asset.id]
                                      : [asset.id],
                                );
                              }}
                            >
                              <i className="size-12 overflow-hidden rounded-md bg-surface-muted [&_img]:size-full [&_img]:object-cover [&_video]:size-full [&_video]:object-cover">
                                <AuthenticatedMedia
                                  url={asset.url}
                                  mimeType={asset.mimeType}
                                  alt={asset.name}
                                  controls={false}
                                  previewable={false}
                                  className="size-full"
                                />
                              </i>
                              <span>
                                <b>{asset.name}</b>
                                <small className="type-helper">
                                  {asset.mimeType} · {formatBytes(asset.size)}
                                  {formatDuration(asset.durationSec) ? ` · ${formatDuration(asset.durationSec)}` : ""}
                                  {reason ? ` · ${reason}` : ""}
                                </small>
                              </span>
                              {active && <Check className="attachment-check" />}
                            </Button>
                          );
                        })}
                        {(isLoading || foldersLoading) && <p>正在加载素材库…</p>}
                        {!isLoading && !foldersLoading && !filteredByMediaType.length && !childFolders.length && (
                          <p>当前文件夹暂无符合格式的文件，可切换到本地上传。</p>
                        )}
                      </div>
                    </section>
                    {previewAsset && (
                      <aside className="attachment-preview-panel" aria-live="polite">
                        <header>
                          <span>
                            <b>内容预览</b>
                            <small className="type-helper">{previewAsset.mimeType}</small>
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label="关闭文件预览"
                            onClick={() => setPreviewId("")}
                          >
                            <X />
                          </Button>
                        </header>
                        <div className={`attachment-media-preview preview-${previewAsset.mimeType.split("/")[0]}`}>
                          <AuthenticatedMedia
                            key={previewAsset.id}
                            url={previewAsset.url}
                            originalUrl={previewAsset.originalUrl}
                            mimeType={previewAsset.mimeType}
                            alt={previewAsset.name}
                            withAudioControls
                            className="size-full object-contain"
                            containerClassName="size-full"
                          />
                        </div>
                        <div className="attachment-preview-meta">
                          <b title={previewAsset.name}>{previewAsset.name}</b>
                          <span>
                            {previewAsset.width && previewAsset.height
                              ? `${previewAsset.width} × ${previewAsset.height} · `
                              : ""}
                            {formatDuration(previewAsset.durationSec)
                              ? `${formatDuration(previewAsset.durationSec)} · `
                              : ""}
                            {formatBytes(previewAsset.size)}
                          </span>
                          {previewAsset.description && <p>{previewAsset.description}</p>}
                        </div>
                      </aside>
                    )}
                  </div>
                </div>
              ) : (
                <div className="attachment-upload-panel">
                  <FileUpload
                    label="选择本地文件"
                    accept={accept}
                    multiple={multiple}
                    files={uploadFiles}
                    uploadedFiles={uploadedFiles}
                    uploading={uploading}
                    progress={uploadProgress}
                    error={error}
                    description={`${constraints?.summary.join("；") ?? ""}${constraints?.summary.length ? "。" : ""}将上传到“${currentFolder?.name ?? "默认"}”，上传后可在素材库中重复使用。`}
                    onFilesChange={(files) => void upload(files)}
                    onClear={() => {
                      setUploadFiles([]);
                      setUploadedFiles([]);
                      setUploadProgress(0);
                      setError("");
                    }}
                    onRetry={uploadFiles.length ? () => void upload(uploadFiles, uploadedFiles) : undefined}
                  />
                </div>
              )}
              {error && source === "library" && <p className="attachment-error">{error}</p>}
              <footer>
                <Button type="button" variant="outline" size="sm" onClick={close}>
                  取消
                </Button>
                {source === "library" && (
                  <Button type="button" variant="default" size="sm" disabled={!selected.length} onClick={chooseLibrary}>
                    使用所选素材{selected.length ? `（${selected.length}）` : ""}
                  </Button>
                )}
                {source === "upload" && uploadedFiles.length > 0 && (
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    onClick={() => {
                      onSelect(uploadedFiles);
                      close();
                    }}
                  >
                    使用已上传文件
                  </Button>
                )}
              </footer>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
