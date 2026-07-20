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
  LoaderCircle,
  Search,
  Upload,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { fetchAssetFolders, fetchLibraryAssets, uploadMediaFile } from "@/api/api-client";
import type { AssetFolder, LibraryAsset } from "@/entities/types";

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
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<"library" | "upload">("library");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [folderId, setFolderId] = useState("");
  const [uploading, setUploading] = useState(false);
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
  const close = () => {
    setOpen(false);
    setSelected([]);
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
  const upload = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    setError("");
    try {
      const uploaded = await Promise.all(
        (multiple ? files : files.slice(0, 1)).map((file) => uploadMediaFile(file, folderId || undefined)),
      );
      onSelect(
        uploaded.map((asset) => ({
          id: asset.id,
          name: asset.name,
          mimeType: asset.mimeType,
          size: asset.size,
          url: asset.url,
          source: "upload" as const,
        })),
      );
      void queryClient.invalidateQueries({ queryKey: ["asset-library", "media"] });
      close();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "附件上传失败");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
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
              <div>
                <span>ATTACHMENT</span>
                <h2>选择附件</h2>
              </div>
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
                            onClick={() =>
                              setSelected((current) =>
                                active
                                  ? current.filter((id) => id !== asset.id)
                                  : multiple
                                    ? [...current, asset.id]
                                    : [asset.id],
                              )
                            }
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
                  </section>
                </div>
              </div>
            ) : (
              <div className="attachment-upload-panel">
                <input
                  ref={fileInput}
                  type="file"
                  hidden
                  accept={accept}
                  multiple={multiple}
                  onChange={(event) => void upload(Array.from(event.target.files ?? []))}
                />
                <button type="button" disabled={uploading} onClick={() => fileInput.current?.click()}>
                  {uploading ? <LoaderCircle className="animate-spin" /> : <Upload />}
                  <b>{uploading ? "正在上传…" : "点击选择本地文件"}</b>
                  <span>将上传到“{currentFolder?.name ?? "默认"}”，后续可重复使用</span>
                </button>
              </div>
            )}
            {error && <p className="attachment-error">{error}</p>}
            <footer>
              <button type="button" onClick={close}>
                取消
              </button>
              {source === "library" && (
                <button type="button" className="primary" disabled={!selected.length} onClick={chooseLibrary}>
                  使用所选素材{selected.length ? `（${selected.length}）` : ""}
                </button>
              )}
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
