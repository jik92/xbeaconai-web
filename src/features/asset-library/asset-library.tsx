// biome-ignore-all lint/a11y/useButtonType: This asset workbench contains no forms.
// biome-ignore-all lint/a11y/noStaticElementInteractions: Modal backdrops dismiss their dialogs.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AudioLines,
  Check,
  FileAudio,
  Files,
  Folder,
  FolderPlus,
  Image as ImageIcon,
  Package,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  createAssetFolder,
  deleteAssetFolder,
  fetchAssetFolders,
  fetchLibraryAssets,
  fetchProducts,
  renameAssetFolder,
  uploadLibraryAsset,
  uploadProduct,
} from "@/api/api-client";
import { AuthenticatedMedia } from "@/components/domain/authenticated-media";
import type { LibraryAsset, LibraryProduct } from "@/entities/types";
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
  const previews = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);
  useEffect(() => () => previews.forEach(URL.revokeObjectURL), [previews]);

  const { data = [], isLoading, error } = useQuery({ queryKey: ["product-library"], queryFn: fetchProducts });
  const upload = useMutation({
    mutationFn: () => {
      if (!files.length) throw new Error("请至少选择一张商品图");
      if (!name.trim()) throw new Error("请填写产品名称");
      return uploadProduct({ files, name: name.trim(), description: description.trim(), sharingScope });
    },
    onSuccess: (product) => {
      void queryClient.invalidateQueries({ queryKey: ["product-library"] });
      void queryClient.invalidateQueries({ queryKey: ["asset-library", "product"] });
      setUploadOpen(false);
      setFiles([]);
      setName("");
      setDescription("");
      setSharingScope("private");
      setSelected(product);
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

  return (
    <div className="asset-library-page">
      <LibraryHeader
        eyebrow="ASSET / PRODUCT"
        title="商品库"
        description="一个商品可绑定多张主图、包装图与细节图；创作时会整组加载给 AI。"
        count={data.length}
      />
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
            <label className="asset-file-drop product-file-drop">
              <input
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => setFiles(Array.from(event.target.files || []).slice(0, 8))}
              />
              <Upload />
              <b>{files.length ? `已选择 ${files.length} 张商品图` : "点击选择多张商品图"}</b>
              <span>PNG、JPG、WEBP，最多 8 张，创作时将全部提供给 AI</span>
            </label>
            {!!previews.length && (
              <div className="product-upload-previews">
                {previews.map((preview, index) => (
                  <img key={preview} src={preview} alt={`待上传商品图 ${index + 1}`} />
                ))}
              </div>
            )}
            <label>
              形态描述
              <textarea
                value={description}
                maxLength={1000}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="描述产品形态、材质、卖点等"
              />
            </label>
            {upload.error && <p className="asset-upload-error">{upload.error.message}</p>}
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

function ReusableAssetLibrary({ kind }: { kind: "media" | "voice" }) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selected, setSelected] = useState<LibraryAsset | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const { data: folders = [] } = useQuery({
    queryKey: ["asset-folders"],
    queryFn: fetchAssetFolders,
    enabled: kind === "media",
  });
  useEffect(() => {
    if (kind === "media" && !selectedFolderId && folders[0]) setSelectedFolderId(folders[0].id);
  }, [folders, kind, selectedFolderId]);
  const {
    data = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["asset-library", kind, selectedFolderId],
    queryFn: () => fetchLibraryAssets(kind, kind === "media" ? selectedFolderId || undefined : undefined),
    enabled: kind !== "media" || Boolean(selectedFolderId),
  });
  const upload = useMutation({
    mutationFn: () => {
      if (!file) throw new Error("请选择上传文件");
      return uploadLibraryAsset(
        file,
        kind,
        name.trim() || file.name.replace(/\.[^.]+$/, ""),
        description,
        kind === "media" ? selectedFolderId : undefined,
      );
    },
    onSuccess: (asset) => {
      void queryClient.invalidateQueries({ queryKey: ["asset-library", kind] });
      setUploadOpen(false);
      setFile(null);
      setName("");
      setDescription("");
      setSelected(asset);
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
  const addFolder = async () => {
    const folderName = window.prompt("请输入新文件夹名称");
    if (!folderName?.trim()) return;
    try {
      const folder = await createAssetFolder(folderName.trim());
      await queryClient.invalidateQueries({ queryKey: ["asset-folders"] });
      setSelectedFolderId(folder.id);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "文件夹创建失败");
    }
  };
  const renameFolder = async (folderId: string, currentName: string) => {
    const folderName = window.prompt("请输入新的文件夹名称", currentName);
    if (!folderName?.trim() || folderName.trim() === currentName) return;
    try {
      await renameAssetFolder(folderId, folderName.trim());
      await queryClient.invalidateQueries({ queryKey: ["asset-folders"] });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "文件夹重命名失败");
    }
  };
  const removeFolder = async (folderId: string) => {
    if (!window.confirm("确定删除这个空文件夹吗？")) return;
    try {
      await deleteAssetFolder(folderId);
      setSelectedFolderId("");
      await queryClient.invalidateQueries({ queryKey: ["asset-folders"] });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "文件夹删除失败");
    }
  };

  return (
    <div className={`asset-library-page ${kind === "media" ? "material-library-page" : ""}`}>
      {kind === "media" && (
        <aside className="material-folder-sidebar">
          <header>
            <b>全部专辑</b>
            <button type="button" aria-label="新建文件夹" onClick={() => void addFolder()}>
              <FolderPlus />
            </button>
          </header>
          <nav>
            {folders.map((folder) => (
              <div key={folder.id} className={selectedFolderId === folder.id ? "active" : ""}>
                <button type="button" onClick={() => setSelectedFolderId(folder.id)}>
                  <Folder />
                  <span>{folder.name}</span>
                </button>
                <span className="folder-actions">
                  <button
                    type="button"
                    aria-label={`重命名 ${folder.name}`}
                    onClick={() => void renameFolder(folder.id, folder.name)}
                  >
                    <Pencil />
                  </button>
                  <button type="button" aria-label={`删除 ${folder.name}`} onClick={() => void removeFolder(folder.id)}>
                    <Trash2 />
                  </button>
                </span>
              </div>
            ))}
          </nav>
          <footer>
            <span>用户存储目录</span>
            <b>{folders.find((folder) => folder.id === selectedFolderId)?.storagePrefix ?? "正在初始化…"}</b>
          </footer>
        </aside>
      )}
      <div className="material-library-content">
        <LibraryHeader
          eyebrow={kind === "voice" ? "ASSET / VOICE" : "ASSET / MEDIA"}
          title={kind === "voice" ? "音色库" : "素材库"}
          description={
            kind === "voice"
              ? "管理配音样本和克隆音色参考，支持 MP3、WAV、M4A、OGG。"
              : "集中管理任务中上传的图片、视频和音频，可在所有通用附件入口重复使用。"
          }
          count={data.length}
        />
        <LibraryToolbar
          query={query}
          setQuery={setQuery}
          title={kind === "voice" ? "音色库" : "素材库"}
          uploadLabel={kind === "voice" ? "上传音色" : "上传素材"}
          onUpload={() => setUploadOpen(true)}
        />
        <div className="asset-library-results">
          <b>{filtered.length}</b> 个匹配结果
        </div>
        <section className="asset-library-grid">
          {filtered.map((asset) => (
            <button className="library-asset-card" key={asset.id} onClick={() => setSelected(asset)}>
              <div className={`library-asset-preview ${kind === "voice" ? "voice" : "media"}`}>
                {kind === "media" && /^(image|video)\//.test(asset.mimeType) ? (
                  <AuthenticatedMedia url={asset.url} mimeType={asset.mimeType} alt={asset.name} />
                ) : kind === "voice" ? (
                  <>
                    <FileAudio />
                    <i>试听音色</i>
                  </>
                ) : (
                  <>
                    <FileAudio />
                    <i>音频素材</i>
                  </>
                )}
              </div>
              <div>
                <h3>{asset.name}</h3>
                <p>{asset.description || asset.originalName}</p>
                <small>
                  {(asset.size / 1024 / 1024).toFixed(1)} MB · {new Date(asset.createdAt).toLocaleDateString("zh-CN")}
                </small>
              </div>
            </button>
          ))}
          <LibraryState
            loading={isLoading}
            error={error}
            empty={!filtered.length}
            icon={kind === "voice" ? <AudioLines /> : <Files />}
            emptyText={kind === "voice" ? "还没有音色资产" : "还没有通用素材"}
            onUpload={() => setUploadOpen(true)}
          />
        </section>
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
            <label className="asset-file-drop">
              <input
                type="file"
                accept={
                  kind === "voice"
                    ? "audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/ogg,audio/webm"
                    : "image/*,video/*,audio/*"
                }
                onChange={(event) => {
                  const next = event.target.files?.[0] || null;
                  setFile(next);
                  if (next && !name) setName(next.name.replace(/\.[^.]+$/, ""));
                }}
              />
              <Upload />
              <b>{file?.name || "点击选择文件"}</b>
              <span>
                {kind === "voice"
                  ? "MP3、WAV、M4A、OGG，建议 10–60 秒干声"
                  : "支持常见图片、视频和音频格式，单文件最大 500MB"}
              </span>
            </label>
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
            {upload.error && <p className="asset-upload-error">{upload.error.message}</p>}
            <ModalFooter
              disabled={!file || upload.isPending}
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
            <div className={`asset-detail-media ${kind === "voice" ? "voice" : "media"}`}>
              {kind === "media" && /^(image|video)\//.test(selected.mimeType) ? (
                <AuthenticatedMedia url={selected.url} mimeType={selected.mimeType} alt={selected.name} />
              ) : (
                <FileAudio />
              )}
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

function LibraryHeader({
  eyebrow,
  title,
  description,
  count,
}: {
  eyebrow: string;
  title: string;
  description: string;
  count: number;
}) {
  return (
    <header className="asset-library-head">
      <div>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="asset-library-stat">
        <b>{count}</b>
        <span>我的资产</span>
      </div>
    </header>
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
      <button className="primary" onClick={onUpload}>
        <Upload /> {uploadLabel}
      </button>
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
