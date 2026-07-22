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
import { fetchAssetFolders, fetchLibraryAssets, uploadMediaFile } from "@/api/api-client";
import type { AssetFolder, LibraryAsset } from "@/entities/types";
import { AuthenticatedMedia } from "./authenticated-media";
import { FileUpload } from "./file-upload";

export interface AttachmentSelection {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  url?: string;
  source: "library" | "upload";
}

function accepts(asset: LibraryAsset, accept: string) {
  if (!accept || accept === "*/*") return true;
  return accept.split(",").some((raw) => {
    const rule = raw.trim();
    if (rule.endsWith("/*")) return asset.mimeType.startsWith(rule.slice(0, -1));
    return rule === asset.mimeType;
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
  trigger,
  onSelect,
}: {
  accept?: string;
  multiple?: boolean;
  trigger: (open: () => void) => ReactNode;
  onSelect: (assets: AttachmentSelection[]) => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<"library" | "upload">("library");
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
  const previewAsset =
    data.find((asset) => asset.id === previewId) ?? data.find((asset) => asset.id === selected.at(-1));
  const close = () => {
    setOpen(false);
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
        url: asset.url,
        source: "library" as const,
      }));
    if (!assets.length) return;
    onSelect(assets);
    close();
  };
  const upload = async (files: File[], retainedUploads: AttachmentSelection[] = []) => {
    if (!files.length) return;
    const pendingFiles = multiple ? files : files.slice(0, 1);
    const totalBytes = pendingFiles.reduce((total, file) => total + Math.max(file.size, 1), 0);
    const fileProgress = pendingFiles.map(() => 0);
    setUploadFiles(pendingFiles);
    setUploadedFiles(retainedUploads);
    setUploadProgress(0);
    setUploading(true);
    setError("");
    try {
      const results = await Promise.all(
        pendingFiles.map(async (file, index) => {
          try {
            const asset = await uploadMediaFile(file, folderId || undefined, (progress) => {
              fileProgress[index] = progress;
              const weightedProgress = fileProgress.reduce(
                (total, current, currentIndex) => total + current * Math.max(pendingFiles[currentIndex]?.size ?? 0, 1),
                0,
              );
              setUploadProgress(Math.round(weightedProgress / totalBytes));
            });
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
                url: result.asset.url,
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
      {trigger(() => setOpen(true))}
      {open && (
        <div className="attachment-picker-layer" role="presentation" onMouseDown={close}>
          <section
            className="attachment-picker-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="选择附件"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <h2 className="text-ink">选择附件</h2>
              <button type="button" aria-label="关闭" onClick={close}>
                <X />
              </button>
            </header>
            <div className="attachment-source-tabs">
              <button
                type="button"
                className={source === "library" ? "active" : ""}
                onClick={() => setSource("library")}
              >
                <FolderOpen /> 从素材库选择
              </button>
              <button type="button" className={source === "upload" ? "active" : ""} onClick={() => setSource("upload")}>
                <Upload /> 从本地上传
              </button>
            </div>
            {source === "library" ? (
              <div className="attachment-library-panel">
                <div className="attachment-directory-layout">
                  <aside className="attachment-folder-tree">
                    <b>全部文件夹</b>
                    <nav>
                      {orderedFolders.map(({ folder, depth }) => (
                        <button
                          type="button"
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
                        </button>
                      ))}
                    </nav>
                  </aside>
                  <section className="attachment-folder-files">
                    <label className="attachment-search">
                      <Search />
                      <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="搜索当前文件夹…"
                      />
                    </label>
                    <div className="attachment-breadcrumbs">
                      {breadcrumbs.map((folder, index) => (
                        <span key={folder.id}>
                          {index > 0 && <ChevronRight />}
                          <button type="button" onClick={() => setFolderId(folder.id)}>
                            {folder.name}
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="attachment-content-layout">
                      <div className="attachment-grid">
                        {!query.trim() &&
                          childFolders.map((folder) => (
                            <button
                              type="button"
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
                                <small>文件夹</small>
                              </span>
                              <ChevronRight />
                            </button>
                          ))}
                        {filtered.map((asset) => {
                          const active = selected.includes(asset.id);
                          return (
                            <button
                              type="button"
                              key={asset.id}
                              className={active ? "active" : ""}
                              onMouseEnter={() => setPreviewId(asset.id)}
                              onFocus={() => setPreviewId(asset.id)}
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
                              <i>
                                <AssetIcon mimeType={asset.mimeType} />
                              </i>
                              <span>
                                <b>{asset.name}</b>
                                <small>{asset.mimeType}</small>
                              </span>
                              {active && <Check className="attachment-check" />}
                            </button>
                          );
                        })}
                        {(isLoading || foldersLoading) && <p>正在加载素材库…</p>}
                        {!isLoading && !foldersLoading && !filtered.length && !childFolders.length && (
                          <p>当前文件夹暂无符合格式的文件，可切换到本地上传。</p>
                        )}
                      </div>
                      <aside className="attachment-preview-panel" aria-live="polite">
                        <header>
                          <b>内容预览</b>
                          <small>{previewAsset ? previewAsset.mimeType : "选择或悬停素材"}</small>
                        </header>
                        {previewAsset ? (
                          <>
                            <div className={`attachment-media-preview preview-${previewAsset.mimeType.split("/")[0]}`}>
                              <AuthenticatedMedia
                                key={previewAsset.id}
                                url={previewAsset.url}
                                mimeType={previewAsset.mimeType}
                                alt={previewAsset.name}
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
                          </>
                        ) : (
                          <div className="attachment-preview-empty">
                            <FileImage />
                            <span>在左侧悬停或选择素材后，可在这里查看真实内容。</span>
                          </div>
                        )}
                      </aside>
                    </div>
                  </section>
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
                  description={`将上传到“${currentFolder?.name ?? "默认"}”，上传后可在素材库中重复使用。`}
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
              <button type="button" onClick={close}>
                取消
              </button>
              {source === "library" && (
                <button type="button" className="primary" disabled={!selected.length} onClick={chooseLibrary}>
                  使用所选素材{selected.length ? `（${selected.length}）` : ""}
                </button>
              )}
              {source === "upload" && uploadedFiles.length > 0 && (
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    onSelect(uploadedFiles);
                    close();
                  }}
                >
                  使用已上传文件
                </button>
              )}
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
