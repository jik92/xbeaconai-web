// biome-ignore-all lint/a11y/useButtonType: This asset workbench contains no forms.
// biome-ignore-all lint/a11y/noStaticElementInteractions: Modal backdrops dismiss their dialogs.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  AudioLines,
  Check,
  FileAudio,
  Files,
  Image as ImageIcon,
  Package,
  Play,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteLibraryAsset,
  deleteLibraryProduct,
  fetchAssetFolders,
  fetchLibraryAssets,
  fetchProducts,
  saveAssetMetadata,
  uploadLibraryAsset,
  uploadProduct,
} from "@/api/api-client";
import { AssetPageShell, AssetPageToolbar } from "@/components/domain/asset-page-shell";
import { AuthenticatedMedia } from "@/components/domain/authenticated-media";
import { FileUpload } from "@/components/domain/file-upload";
import { ToolCreatorModal } from "@/components/domain/tool-creator-modal";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LibraryAsset, LibraryProduct } from "@/entities/types";
import { AssetFolderSpace } from "./asset-folder-space";
import { fitMediaPreviewSize } from "./media-preview-size";
import "./asset-library.css";

type LibraryKind = "media" | "product" | "voice";

export function AssetLibrary({ kind }: { kind: LibraryKind }) {
  return kind === "product" ? <ProductLibrary /> : <ReusableAssetLibrary kind={kind} />;
}

function ProductLibrary() {
  const requestedProductId = new URLSearchParams(window.location.search).get("productId");
  const requestedProductLocated = useRef(false);
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selected, setSelected] = useState<LibraryProduct | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sharingScope, setSharingScope] = useState<LibraryProduct["sharingScope"]>("private");
  const [uploadProgress, setUploadProgress] = useState(0);

  const { data = [], isLoading, error } = useQuery({ queryKey: ["product-library"], queryFn: fetchProducts });
  useEffect(() => {
    if (!requestedProductId || requestedProductLocated.current) return;
    const product = data.find((item) => item.id === requestedProductId);
    if (product) {
      requestedProductLocated.current = true;
      setSelected(product);
    }
  }, [data, requestedProductId]);
  const upload = useMutation({
    mutationFn: () => {
      if (!files.length) throw new Error("请至少选择一张商品图");
      if (!name.trim()) throw new Error("请填写产品名称");
      return uploadProduct({
        files,
        name: name.trim(),
        description: description.trim(),
        sharingScope,
        onProgress: setUploadProgress,
      });
    },
    onMutate: () => setUploadProgress(0),
    onSuccess: (product) => {
      void queryClient.invalidateQueries({ queryKey: ["product-library"] });
      void queryClient.invalidateQueries({ queryKey: ["asset-library", "product"] });
      setUploadOpen(false);
      setFiles([]);
      setName("");
      setDescription("");
      setSharingScope("private");
      setUploadProgress(0);
      setSelected(product);
    },
  });
  const remove = useMutation({
    mutationFn: deleteLibraryProduct,
    onSuccess: (_, productId) => {
      void queryClient.invalidateQueries({ queryKey: ["product-library"] });
      void queryClient.invalidateQueries({ queryKey: ["asset-library", "product"] });
      const saved = localStorage.getItem("studio:selectedProduct");
      if (saved) {
        try {
          if ((JSON.parse(saved) as { id?: string }).id === productId)
            localStorage.removeItem("studio:selectedProduct");
        } catch {
          localStorage.removeItem("studio:selectedProduct");
        }
      }
      setSelected(null);
    },
  });
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return keyword
      ? data.filter((product) => `${product.name} ${product.description || ""}`.toLowerCase().includes(keyword))
      : data;
  }, [data, query]);
  const applyToRemix = (product: LibraryProduct) => {
    localStorage.setItem("studio:selectedProduct", JSON.stringify(product));
    window.location.assign("/aigc/video-remix");
  };
  const removeProduct = async (product: LibraryProduct) => {
    if (!window.confirm(`确定永久删除商品“${product.name}”及其 ${product.images.length} 张图片吗？此操作无法撤销。`))
      return;
    try {
      await remove.mutateAsync(product.id);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "商品删除失败");
    }
  };

  return (
    <>
      <AssetPageShell
        count={filtered.length}
        toolbar={
          <LibraryToolbar
            query={query}
            setQuery={setQuery}
            title="商品库"
            uploadLabel="创建商品"
            onUpload={() => setUploadOpen(true)}
          />
        }
      >
        <section className="asset-library-grid h-full overflow-y-auto pb-3">
          {filtered.map((product) => (
            <button className="library-asset-card" key={product.id} onClick={() => setSelected(product)}>
              <div className="library-asset-preview product">
                <AuthenticatedMedia
                  url={product.images[0]?.url || ""}
                  mimeType={product.images[0]?.mimeType || "image/png"}
                  alt={product.name}
                />
                <i className="product-image-count">
                  <ImageIcon /> {product.images.length} 张
                </i>
              </div>
              <div>
                <h3>{product.name}</h3>
                <p>{product.description || "暂无形态描述"}</p>
                <small>
                  {scopeLabel(product.sharingScope)} · {new Date(product.createdAt).toLocaleDateString("zh-CN")}
                </small>
              </div>
            </button>
          ))}
          <LibraryState
            loading={isLoading}
            error={error}
            empty={!filtered.length}
            icon={<Package />}
            emptyText="还没有商品"
            onUpload={() => setUploadOpen(true)}
          />
        </section>
      </AssetPageShell>

      <ToolCreatorModal open={uploadOpen} title="创建商品" onClose={() => setUploadOpen(false)}>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 text-sm">
          <Label className="flex-col items-start text-xs text-muted">
            <span>
              产品名称 <b className="text-danger">*</b>
            </span>
            <Input
              value={name}
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
              placeholder="请输入产品名称"
            />
          </Label>
          <fieldset className="flex flex-wrap gap-3 text-xs text-muted">
            <legend className="mb-2 w-full font-medium text-ink">
              共享范围 <b className="text-danger">*</b>
            </legend>
            {(["private", "team", "organization"] as const).map((scope) => (
              <label className="flex items-center gap-1.5" key={scope}>
                <input type="radio" checked={sharingScope === scope} onChange={() => setSharingScope(scope)} />
                {scopeLabel(scope)}
              </label>
            ))}
          </fieldset>
          <FileUpload
            label="商品图片"
            multiple
            accept="image/png,image/jpeg,image/webp"
            files={files}
            uploading={upload.isPending}
            progress={uploadProgress}
            error={upload.error?.message}
            description={
              files.length
                ? `已选择 ${files.length} 张商品图，最多上传 8 张。`
                : "PNG、JPG、WEBP，最多 8 张，创作时将全部提供给 AI。"
            }
            onFilesChange={(nextFiles) => {
              upload.reset();
              setUploadProgress(0);
              setFiles(nextFiles.slice(0, 8));
            }}
            onClear={() => {
              upload.reset();
              setFiles([]);
              setUploadProgress(0);
            }}
          />
          <Label className="flex-col items-start text-xs text-muted">
            形态描述
            <textarea
              className="min-h-20 w-full resize-y rounded-md border border-line bg-transparent p-3 text-sm text-ink outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
              value={description}
              maxLength={1000}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="描述产品形态、材质、卖点等"
            />
          </Label>
        </div>
        <ModalFooter
          disabled={!files.length || !name.trim() || upload.isPending}
          pending={upload.isPending}
          onCancel={() => setUploadOpen(false)}
          onConfirm={() => upload.mutate()}
        />
      </ToolCreatorModal>

      <ToolCreatorModal open={Boolean(selected)} title={selected?.name ?? "商品详情"} onClose={() => setSelected(null)}>
        {selected && (
          <>
            <div className="product-detail-gallery">
              {selected.images.map((image) => (
                <AuthenticatedMedia key={image.id} url={image.url} mimeType={image.mimeType} alt={selected.name} />
              ))}
            </div>
            <div className="asset-detail-copy">
              <span>
                <Check /> 已绑定 {selected.images.length} 张商品图，创作时整组加载
              </span>
              <p>{selected.description || "暂无形态描述"}</p>
              <small>{scopeLabel(selected.sharingScope)}</small>
            </div>
            <footer className="flex h-13 flex-none items-center justify-end gap-2 border-t border-line px-4">
              <Button
                className="mr-auto text-danger"
                size="sm"
                variant="outline"
                disabled={remove.isPending}
                onClick={() => void removeProduct(selected)}
              >
                <Trash2 /> {remove.isPending ? "删除中…" : "删除商品"}
              </Button>
              <Button size="sm" onClick={() => applyToRemix(selected)}>
                <Package /> 用于爆款二创
              </Button>
            </footer>
          </>
        )}
      </ToolCreatorModal>
    </>
  );
}

type MediaMetadata = { width?: number; height?: number; durationSec?: number };

async function inspectMediaFile(file: File): Promise<MediaMetadata> {
  const url = URL.createObjectURL(file);
  try {
    if (file.type.startsWith("image/"))
      return await new Promise<MediaMetadata>((resolve) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => resolve({});
        image.src = url;
      });
    if (file.type.startsWith("video/") || file.name.toLowerCase().endsWith(".mp4"))
      return await new Promise<MediaMetadata>((resolve) => {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.onloadedmetadata = () =>
          resolve({
            width: video.videoWidth || undefined,
            height: video.videoHeight || undefined,
            durationSec: Number.isFinite(video.duration) ? video.duration : undefined,
          });
        video.onerror = () => resolve({});
        video.src = url;
      });
    if (file.type.startsWith("audio/"))
      return await new Promise<MediaMetadata>((resolve) => {
        const audio = document.createElement("audio");
        audio.preload = "metadata";
        audio.onloadedmetadata = () =>
          resolve({ durationSec: Number.isFinite(audio.duration) ? audio.duration : undefined });
        audio.onerror = () => resolve({});
        audio.src = url;
      });
    return {};
  } finally {
    URL.revokeObjectURL(url);
  }
}

function LazyVideoPreview({
  asset,
  onMetadata,
}: {
  asset: LibraryAsset;
  onMetadata: (metadata: MediaMetadata) => void;
}) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="lazy-video-preview">
      <AuthenticatedMedia
        url={asset.url}
        mimeType={asset.mimeType}
        alt={asset.name}
        controls={playing}
        autoPlay={playing}
        onMetadata={onMetadata}
      />
      {!playing && (
        <button type="button" aria-label={`播放 ${asset.name}`} onClick={() => setPlaying(true)}>
          <Play /> 播放
        </button>
      )}
    </div>
  );
}

function formatDuration(durationSec?: number) {
  if (durationSec === undefined || !Number.isFinite(durationSec)) return "—";
  const seconds = Math.max(0, Math.round(durationSec));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function MediaAssetTable({
  assets,
  loading,
  error,
  loadedMetadata,
  onMetadata,
  onUpload,
  onDelete,
  deleting,
}: {
  assets: LibraryAsset[];
  loading: boolean;
  error: unknown;
  loadedMetadata: Record<string, MediaMetadata>;
  onMetadata: (assetId: string, metadata: MediaMetadata) => void;
  onUpload: () => void;
  onDelete: (asset: LibraryAsset) => void;
  deleting: boolean;
}) {
  const loadedMetadataRef = useRef(loadedMetadata);
  const onMetadataRef = useRef(onMetadata);
  const onDeleteRef = useRef(onDelete);
  const deletingRef = useRef(deleting);
  loadedMetadataRef.current = loadedMetadata;
  onMetadataRef.current = onMetadata;
  onDeleteRef.current = onDelete;
  deletingRef.current = deleting;
  const columns = useMemo<ColumnDef<LibraryAsset, unknown>[]>(
    () => [
      {
        id: "preview",
        header: "内容预览",
        size: 260,
        cell: ({ row }) => {
          const asset = row.original;
          const metadata = loadedMetadataRef.current[asset.id];
          const previewSize = fitMediaPreviewSize(asset.width ?? metadata?.width, asset.height ?? metadata?.height);
          const media = asset.mimeType.startsWith("video/") ? (
            <LazyVideoPreview asset={asset} onMetadata={(next) => onMetadataRef.current(asset.id, next)} />
          ) : (
            <AuthenticatedMedia
              url={asset.url}
              mimeType={asset.mimeType}
              alt={asset.name}
              controls={asset.mimeType.startsWith("audio/")}
              onMetadata={(next) => onMetadataRef.current(asset.id, next)}
            />
          );
          return (
            <div
              className={`media-table-preview ${asset.mimeType.startsWith("audio/") ? "audio" : asset.mimeType.startsWith("video/") ? "video" : ""}`}
            >
              {asset.mimeType.startsWith("audio/") ? (
                media
              ) : (
                <div className="media-table-preview-content" style={previewSize ?? { width: "100%", height: "100%" }}>
                  {media}
                </div>
              )}
            </div>
          );
        },
      },
      {
        id: "name",
        header: "素材名称",
        size: 300,
        cell: ({ row }) => (
          <>
            <b className="media-table-name">{row.original.name}</b>
            <small>{row.original.originalName}</small>
          </>
        ),
      },
      {
        id: "dimensions",
        header: "宽高",
        size: 130,
        cell: ({ row }) => {
          const asset = row.original;
          const width = asset.width ?? loadedMetadataRef.current[asset.id]?.width;
          const height = asset.height ?? loadedMetadataRef.current[asset.id]?.height;
          return width && height ? `${width} × ${height}` : "—";
        },
      },
      {
        id: "duration",
        header: "时长",
        size: 130,
        cell: ({ row }) => {
          const asset = row.original;
          return formatDuration(asset.durationSec ?? loadedMetadataRef.current[asset.id]?.durationSec);
        },
      },
      {
        accessorKey: "createdAt",
        header: "创建时间",
        size: 190,
        cell: ({ getValue }) => new Date(getValue<string>()).toLocaleString("zh-CN", { hour12: false }),
      },
      {
        id: "actions",
        header: "操作",
        size: 90,
        cell: ({ row }) => (
          <button
            type="button"
            className="media-asset-delete"
            disabled={deletingRef.current}
            aria-label={`删除 ${row.original.name}`}
            onClick={() => onDeleteRef.current(row.original)}
          >
            <Trash2 /> 删除
          </button>
        ),
      },
    ],
    [],
  );

  return (
    <DataTable
      className="media-asset-table"
      columns={columns}
      data={assets}
      getRowId={(asset) => asset.id}
      loading={loading}
      loadingMessage="正在加载素材…"
      error={error}
      emptyMessage="还没有素材"
      emptyIcon={<Files />}
      emptyAction={
        <Button size="sm" onClick={onUpload}>
          上传第一个素材
        </Button>
      }
      height="100%"
    />
  );
}

function ReusableAssetLibrary({ kind }: { kind: "media" | "voice" }) {
  const locationParams = new URLSearchParams(window.location.search);
  const requestedFolderId = kind === "media" ? (locationParams.get("folderId") ?? "") : "";
  const requestedAssetId = kind === "voice" ? (locationParams.get("assetId") ?? "") : "";
  const requestedAssetIds = new Set(
    kind === "media" ? (locationParams.get("assetIds") ?? "").split(",").filter(Boolean) : [],
  );
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selected, setSelected] = useState<LibraryAsset | null>(null);
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFolderId, setSelectedFolderId] = useState(requestedFolderId);
  const [loadedMetadata, setLoadedMetadata] = useState<Record<string, MediaMetadata>>({});
  const metadataSaving = useRef(new Set<string>());
  const requestedAssetLocated = useRef(false);
  const { data: folders = [], isLoading: foldersLoading } = useQuery({
    queryKey: ["asset-folders"],
    queryFn: fetchAssetFolders,
    enabled: kind === "media",
  });
  const {
    data = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["asset-library", kind, selectedFolderId],
    queryFn: () => fetchLibraryAssets(kind, kind === "media" ? selectedFolderId || undefined : undefined),
  });
  const dataRef = useRef(data);
  dataRef.current = data;
  useEffect(() => {
    if (!requestedAssetId || requestedAssetLocated.current) return;
    const asset = data.find((item) => item.id === requestedAssetId);
    if (asset) {
      requestedAssetLocated.current = true;
      setSelected(asset);
    }
  }, [data, requestedAssetId]);
  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("请选择上传文件");
      const metadata = kind === "media" ? await inspectMediaFile(file) : undefined;
      return uploadLibraryAsset(
        file,
        kind,
        name.trim() || file.name.replace(/\.[^.]+$/, ""),
        description,
        kind === "media" ? selectedFolderId || folders[0]?.id : undefined,
        setUploadProgress,
        metadata,
      );
    },
    onMutate: () => setUploadProgress(0),
    onSuccess: (asset) => {
      void queryClient.invalidateQueries({ queryKey: ["asset-library", kind] });
      setUploadOpen(false);
      setFile(null);
      setName("");
      setDescription("");
      setUploadProgress(0);
      if (kind === "voice") setSelected(asset);
    },
  });
  const remove = useMutation({
    mutationFn: deleteLibraryAsset,
    onSuccess: (_, assetId) => {
      void queryClient.invalidateQueries({ queryKey: ["asset-library", kind] });
      const savedVoice = localStorage.getItem("studio:selectedVoice");
      if (savedVoice) {
        try {
          if ((JSON.parse(savedVoice) as { id?: string }).id === assetId)
            localStorage.removeItem("studio:selectedVoice");
        } catch {
          localStorage.removeItem("studio:selectedVoice");
        }
      }
      if (selected?.id === assetId) setSelected(null);
      if (previewingVoiceId === assetId) setPreviewingVoiceId(null);
    },
  });
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return keyword
      ? data.filter((item) => `${item.name} ${item.description || ""}`.toLowerCase().includes(keyword))
      : data;
  }, [data, query]);
  const applyToRemix = (asset: LibraryAsset) => {
    localStorage.setItem("studio:selectedVoice", JSON.stringify(asset));
    window.location.assign("/aigc/video-remix");
  };
  const removeAsset = async (asset: LibraryAsset) => {
    const typeName = kind === "voice" ? "音色" : "素材";
    if (!window.confirm(`确定永久删除${typeName}“${asset.name}”吗？此操作无法撤销。`)) return;
    try {
      await remove.mutateAsync(asset.id);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : `${typeName}删除失败`);
    }
  };
  const recordMetadata = useCallback(
    (assetId: string, metadata: MediaMetadata) => {
      setLoadedMetadata((current) => {
        const previous = current[assetId];
        if (
          previous?.width === metadata.width &&
          previous?.height === metadata.height &&
          previous?.durationSec === metadata.durationSec
        )
          return current;
        return { ...current, [assetId]: { ...previous, ...metadata } };
      });
      const asset = dataRef.current.find((item) => item.id === assetId);
      const hasNewMetadata =
        (!asset?.width && metadata.width) ||
        (!asset?.height && metadata.height) ||
        (asset?.durationSec === undefined && metadata.durationSec !== undefined);
      if (!asset || !hasNewMetadata || metadataSaving.current.has(assetId)) return;
      metadataSaving.current.add(assetId);
      void saveAssetMetadata(assetId, metadata)
        .then(() => queryClient.invalidateQueries({ queryKey: ["asset-library", kind] }))
        .finally(() => metadataSaving.current.delete(assetId));
    },
    [kind, queryClient],
  );

  return (
    <>
      <AssetPageShell
        count={filtered.length}
        sidebar={
          kind === "media" ? (
            <AssetFolderSpace
              folders={folders}
              selectedFolderId={selectedFolderId}
              loading={foldersLoading}
              onSelect={setSelectedFolderId}
            />
          ) : undefined
        }
        toolbar={
          <LibraryToolbar
            query={query}
            setQuery={setQuery}
            title={kind === "voice" ? "音色库" : "素材库"}
            uploadLabel={kind === "voice" ? "上传音色" : "上传素材"}
            onUpload={() => setUploadOpen(true)}
          />
        }
      >
        {!!requestedAssetIds.size && (
          <div className="mb-2 flex flex-none items-center gap-1.5 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            <Check /> 已在当前文件夹中定位 {data.filter((asset) => requestedAssetIds.has(asset.id)).length} 个切片
          </div>
        )}
        {kind === "media" ? (
          <MediaAssetTable
            assets={filtered}
            loading={isLoading}
            error={error}
            loadedMetadata={loadedMetadata}
            onMetadata={recordMetadata}
            onUpload={() => setUploadOpen(true)}
            onDelete={(asset) => void removeAsset(asset)}
            deleting={remove.isPending}
          />
        ) : (
          <section className="h-full overflow-y-auto">
            {filtered.map((asset) => (
              <article className="flex min-h-14 items-center gap-3 border-b border-line/60 px-2 py-2" key={asset.id}>
                <div className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-muted text-muted">
                  <FileAudio className="size-4" />
                </div>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelected(asset)}>
                  <b className="block truncate text-xs font-medium text-ink">{asset.name}</b>
                  <span className="block truncate text-2xs text-muted">{asset.description || asset.originalName}</span>
                  <small className="block text-2xs text-muted">
                    {(asset.size / 1024 / 1024).toFixed(1)} MB · {new Date(asset.createdAt).toLocaleDateString("zh-CN")}
                  </small>
                </button>
                {previewingVoiceId === asset.id ? (
                  <div className="w-56 max-w-[40%]">
                    <AuthenticatedMedia url={asset.url} mimeType={asset.mimeType} alt={asset.name} autoPlay controls />
                  </div>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setPreviewingVoiceId(asset.id)}>
                    试听
                  </Button>
                )}
              </article>
            ))}
            <LibraryState
              loading={isLoading}
              error={error}
              empty={!filtered.length}
              icon={<AudioLines />}
              emptyText="还没有音色资产"
              onUpload={() => setUploadOpen(true)}
            />
          </section>
        )}
      </AssetPageShell>
      <ToolCreatorModal
        open={uploadOpen}
        title={kind === "voice" ? "上传音色" : "上传素材"}
        onClose={() => setUploadOpen(false)}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 text-sm">
          <FileUpload
            label={kind === "voice" ? "音色文件" : "素材文件"}
            files={file ? [file] : []}
            uploading={upload.isPending}
            progress={uploadProgress}
            error={upload.error?.message}
            accept={
              kind === "voice"
                ? "audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/ogg,audio/webm"
                : "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/wav,audio/x-wav,audio/ogg,audio/mp4,audio/webm,.mp4,.mov,.webm"
            }
            description={
              file?.name ||
              (kind === "voice"
                ? "MP3、WAV、M4A、OGG，建议 10–60 秒干声。"
                : "支持常见图片、视频和音频格式，单文件最大 500MB。")
            }
            onFilesChange={(files) => {
              const next = files[0] || null;
              upload.reset();
              setFile(next);
              setUploadProgress(0);
              if (next && !name) setName(next.name.replace(/\.[^.]+$/, ""));
            }}
            onClear={() => {
              upload.reset();
              setFile(null);
              setUploadProgress(0);
            }}
          />
          <Label className="flex-col items-start text-xs text-muted">
            资产名称
            <Input
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              placeholder="请输入便于识别的名称"
            />
          </Label>
          <Label className="flex-col items-start text-xs text-muted">
            资产说明
            <textarea
              className="min-h-20 w-full resize-y rounded-md border border-line bg-transparent p-3 text-sm text-ink outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
              value={description}
              maxLength={300}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="选填：音色特征或适用场景"
            />
          </Label>
        </div>
        <ModalFooter
          disabled={!file || upload.isPending}
          pending={upload.isPending}
          onCancel={() => setUploadOpen(false)}
          onConfirm={() => upload.mutate()}
        />
      </ToolCreatorModal>
      <ToolCreatorModal
        open={kind === "voice" && Boolean(selected)}
        title={selected?.name ?? "音色详情"}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <>
            <div className="asset-detail-media voice">
              <AuthenticatedMedia url={selected.url} mimeType={selected.mimeType} alt={selected.name} />
            </div>
            <div className="asset-detail-copy">
              <span>
                <Check /> 已上传，可用于创作
              </span>
              <p>{selected.description || selected.originalName}</p>
              <small>
                {selected.mimeType} · {(selected.size / 1024 / 1024).toFixed(2)} MB
              </small>
            </div>
            <footer className="flex h-13 flex-none items-center justify-end gap-2 border-t border-line px-4">
              <Button
                className="mr-auto text-danger"
                size="sm"
                variant="outline"
                disabled={remove.isPending}
                onClick={() => void removeAsset(selected)}
              >
                <Trash2 /> {remove.isPending ? "删除中…" : "删除音色"}
              </Button>
              <Button size="sm" onClick={() => applyToRemix(selected)}>
                <AudioLines /> 用于爆款二创
              </Button>
            </footer>
          </>
        )}
      </ToolCreatorModal>
    </>
  );
}

function LibraryToolbar({
  query,
  setQuery,
  title,
  uploadLabel,
  onUpload,
}: {
  query: string;
  setQuery: (value: string) => void;
  title: string;
  uploadLabel: string;
  onUpload: () => void;
}) {
  return (
    <AssetPageToolbar
      query={query}
      onQueryChange={setQuery}
      placeholder={`搜索${title}名称或描述`}
      actionLabel={uploadLabel}
      actionIcon={<Upload />}
      onAction={onUpload}
    />
  );
}

function LibraryState({
  loading,
  error,
  empty,
  icon,
  emptyText,
  onUpload,
}: {
  loading: boolean;
  error: unknown;
  empty: boolean;
  icon: ReactNode;
  emptyText: string;
  onUpload: () => void;
}) {
  if (!loading && !error && !empty) return null;
  return (
    <div className={`asset-library-empty ${error ? "error" : ""}`}>
      {icon}
      <b>{loading ? "正在加载资产…" : error instanceof Error ? error.message : emptyText}</b>
      {!loading && !error && (
        <Button size="sm" variant="outline" onClick={onUpload}>
          <Plus /> 立即上传
        </Button>
      )}
    </div>
  );
}

function ModalFooter({
  disabled,
  pending,
  onCancel,
  onConfirm,
}: {
  disabled: boolean;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <footer className="flex h-13 flex-none items-center justify-end gap-2 border-t border-line px-4">
      <Button size="sm" variant="outline" onClick={onCancel}>
        取消
      </Button>
      <Button size="sm" disabled={disabled} onClick={onConfirm}>
        {pending ? "上传中…" : "确认上传"}
      </Button>
    </footer>
  );
}

function scopeLabel(scope: LibraryProduct["sharingScope"]) {
  return scope === "private" ? "不共享" : scope === "team" ? "团队共享" : "总团队共享";
}
