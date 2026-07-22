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
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useMemo, useRef, useState } from "react";
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
import { AuthenticatedMedia } from "@/components/domain/authenticated-media";
import { FileUpload } from "@/components/domain/file-upload";
import { DataTable } from "@/components/ui/data-table";
import type { LibraryAsset, LibraryProduct } from "@/entities/types";
import { AssetFolderSpace } from "./asset-folder-space";
import { fitMediaPreviewSize } from "./media-preview-size";
import "./asset-library.css";

type LibraryKind = "media" | "product" | "voice";

export function AssetLibrary({ kind }: { kind: LibraryKind }) {
  return kind === "product" ? <ProductLibrary /> : <ReusableAssetLibrary kind={kind} />;
}

function ProductLibrary() {
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
    <div className="asset-library-page">
      <LibraryToolbar
        query={query}
        setQuery={setQuery}
        title="商品库"
        uploadLabel="创建商品"
        onUpload={() => setUploadOpen(true)}
      />
      <div className="asset-library-results">
        <b>{filtered.length}</b> 个匹配结果
      </div>
      <section className="asset-library-grid">
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

      {uploadOpen && (
        <div className="asset-modal-layer" role="presentation" onMouseDown={() => setUploadOpen(false)}>
          <aside
            className="asset-upload-modal product-upload-modal"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <ModalHeader eyebrow="ASSET / PRODUCT" title="创建商品" onClose={() => setUploadOpen(false)} />
            <label>
              产品名称 <em>*</em>
              <input
                value={name}
                maxLength={200}
                onChange={(event) => setName(event.target.value)}
                placeholder="请输入产品名称"
              />
            </label>
            <fieldset className="sharing-scope">
              <legend>
                共享范围 <em>*</em>
              </legend>
              {(["private", "team", "organization"] as const).map((scope) => (
                <label key={scope}>
                  <input type="radio" checked={sharingScope === scope} onChange={() => setSharingScope(scope)} />
                  {scopeLabel(scope)}
                </label>
              ))}
            </fieldset>
            <FileUpload
              className="mx-5 my-4"
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
            <label>
              形态描述
              <textarea
                value={description}
                maxLength={1000}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="描述产品形态、材质、卖点等"
              />
            </label>
            <ModalFooter
              disabled={!files.length || !name.trim() || upload.isPending}
              pending={upload.isPending}
              onCancel={() => setUploadOpen(false)}
              onConfirm={() => upload.mutate()}
            />
          </aside>
        </div>
      )}

      {selected && (
        <div className="asset-modal-layer" role="presentation" onMouseDown={() => setSelected(null)}>
          <aside
            className="asset-detail-modal product-detail-modal"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <b>{selected.name}</b>
              <button aria-label="关闭" onClick={() => setSelected(null)}>
                <X />
              </button>
            </header>
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
            <footer>
              <button className="danger" disabled={remove.isPending} onClick={() => void removeProduct(selected)}>
                <Trash2 /> {remove.isPending ? "删除中…" : "删除商品"}
              </button>
              <button className="primary" onClick={() => applyToRemix(selected)}>
                <Package /> 用于爆款二创
              </button>
            </footer>
          </aside>
        </div>
      )}
    </div>
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
      emptyAction={<button onClick={onUpload}>上传第一个素材</button>}
      minWidth={1010}
      height="calc(100vh - 198px)"
    />
  );
}

function ReusableAssetLibrary({ kind }: { kind: "media" | "voice" }) {
  const locationParams = new URLSearchParams(window.location.search);
  const requestedFolderId = kind === "media" ? (locationParams.get("folderId") ?? "") : "";
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
    <div className={`asset-library-page ${kind === "media" ? "material-library-page" : ""}`}>
      {kind === "media" && (
        <AssetFolderSpace
          folders={folders}
          selectedFolderId={selectedFolderId}
          loading={foldersLoading}
          onSelect={setSelectedFolderId}
        />
      )}
      <div className="material-library-content">
        <LibraryToolbar
          query={query}
          setQuery={setQuery}
          title={kind === "voice" ? "音色库" : "素材库"}
          uploadLabel={kind === "voice" ? "上传音色" : "上传素材"}
          onUpload={() => setUploadOpen(true)}
        />
        {!!requestedAssetIds.size && (
          <div className="asset-import-notice">
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
          <>
            <div className="asset-library-results">
              <b>{filtered.length}</b> 个匹配结果
            </div>
            <section className="asset-library-grid">
              {filtered.map((asset) => (
                <article className="library-asset-card voice-asset-card" key={asset.id}>
                  <div className="library-asset-preview voice">
                    {previewingVoiceId === asset.id ? (
                      <AuthenticatedMedia url={asset.url} mimeType={asset.mimeType} alt={asset.name} autoPlay />
                    ) : (
                      <>
                        <FileAudio />
                        <button type="button" onClick={() => setPreviewingVoiceId(asset.id)}>
                          试听音色
                        </button>
                      </>
                    )}
                  </div>
                  <button type="button" className="voice-asset-details" onClick={() => setSelected(asset)}>
                    <h3>{asset.name}</h3>
                    <p>{asset.description || asset.originalName}</p>
                    <small>
                      {(asset.size / 1024 / 1024).toFixed(1)} MB ·{" "}
                      {new Date(asset.createdAt).toLocaleDateString("zh-CN")}
                    </small>
                  </button>
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
          </>
        )}
      </div>
      {uploadOpen && (
        <div className="asset-modal-layer" role="presentation" onMouseDown={() => setUploadOpen(false)}>
          <aside
            className="asset-upload-modal"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <ModalHeader
              eyebrow={kind === "voice" ? "ASSET / VOICE" : "ASSET / MEDIA"}
              title={kind === "voice" ? "上传音色" : "上传素材"}
              onClose={() => setUploadOpen(false)}
            />
            <FileUpload
              className="mx-5 my-4"
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
            <label>
              资产名称
              <input
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                placeholder="请输入便于识别的名称"
              />
            </label>
            <label>
              资产说明
              <textarea
                value={description}
                maxLength={300}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="选填：音色特征或适用场景"
              />
            </label>
            <ModalFooter
              disabled={!file || upload.isPending}
              pending={upload.isPending}
              onCancel={() => setUploadOpen(false)}
              onConfirm={() => upload.mutate()}
            />
          </aside>
        </div>
      )}
      {kind === "voice" && selected && (
        <div className="asset-modal-layer" role="presentation" onMouseDown={() => setSelected(null)}>
          <aside
            className="asset-detail-modal"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <b>{selected.name}</b>
              <button aria-label="关闭" onClick={() => setSelected(null)}>
                <X />
              </button>
            </header>
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
            {kind === "voice" && (
              <footer>
                <button className="danger" disabled={remove.isPending} onClick={() => void removeAsset(selected)}>
                  <Trash2 /> {remove.isPending ? "删除中…" : "删除音色"}
                </button>
                <button className="primary" onClick={() => applyToRemix(selected)}>
                  <AudioLines /> 用于爆款二创
                </button>
              </footer>
            )}
          </aside>
        </div>
      )}
    </div>
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
    <section className="asset-library-toolbar">
      <label>
        <Search />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`搜索${title}名称或描述…`}
        />
      </label>
      <span className="asset-library-toolbar-actions">
        <button className="primary" onClick={onUpload}>
          <Upload /> {uploadLabel}
        </button>
      </span>
    </section>
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
        <>
          <span>点击右上角上传，建立自己的可复用资产库</span>
          <button onClick={onUpload}>
            <Plus /> 立即上传
          </button>
        </>
      )}
    </div>
  );
}

function ModalHeader({ eyebrow, title, onClose }: { eyebrow: string; title: string; onClose: () => void }) {
  return (
    <header>
      <div>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      <button aria-label="关闭" onClick={onClose}>
        <X />
      </button>
    </header>
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
    <footer>
      <button onClick={onCancel}>取消</button>
      <button className="primary" disabled={disabled} onClick={onConfirm}>
        {pending ? "上传中…" : "确认上传"}
      </button>
    </footer>
  );
}

function scopeLabel(scope: LibraryProduct["sharingScope"]) {
  return scope === "private" ? "不共享" : scope === "team" ? "团队共享" : "总团队共享";
}
