import { FileText, LoaderCircle, RotateCcw, UploadCloud, X } from "lucide-react";
import {
  type ComponentProps,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { AuthenticatedMedia } from "./authenticated-media";

export interface UploadPreviewFile {
  id?: string;
  name: string;
  mimeType: string;
  size?: number;
  url?: string;
}

export interface FileUploadProps extends Omit<ComponentProps<"input">, "type" | "onChange" | "value"> {
  label?: ReactNode;
  description?: ReactNode;
  files?: File[];
  uploadedFiles?: UploadPreviewFile[];
  uploading?: boolean;
  progress?: number;
  error?: string;
  onFilesChange: (files: File[]) => void;
  onClear?: () => void;
  onRetry?: () => void;
}

export function fileMatchesAccept(file: Pick<File, "name" | "type">, accept = "") {
  if (!accept.trim() || accept.trim() === "*/*") return true;
  const extension = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
  return accept.split(",").some((rawRule) => {
    const rule = rawRule.trim().toLowerCase();
    if (!rule) return false;
    if (rule.startsWith(".")) return extension === rule;
    if (rule.endsWith("/*")) return file.type.toLowerCase().startsWith(rule.slice(0, -1));
    return file.type.toLowerCase() === rule;
  });
}

function formatBytes(bytes?: number) {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function LocalMediaPreview({ file, url }: { file: File; url: string }) {
  if (file.type.startsWith("image/")) return <img src={url} alt={file.name} />;
  // biome-ignore lint/a11y/useMediaCaption: Local user-selected previews do not have caption tracks yet.
  if (file.type.startsWith("video/")) return <video src={url} controls preload="metadata" />;
  // biome-ignore lint/a11y/useMediaCaption: Local user-selected previews do not have caption tracks yet.
  if (file.type.startsWith("audio/")) return <audio src={url} controls preload="metadata" />;
  return <FileText aria-hidden="true" />;
}

export function FileUpload({
  id,
  className,
  label,
  description,
  files = [],
  uploadedFiles = [],
  uploading = false,
  progress = 0,
  error,
  disabled,
  accept,
  multiple,
  onFilesChange,
  onClear,
  onRetry,
  ...props
}: FileUploadProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = description ? `${inputId}-description` : undefined;
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [localUrls, setLocalUrls] = useState<string[]>([]);
  const hasFiles = files.length > 0 || uploadedFiles.length > 0;
  const visibleError = error || validationError;
  const normalizedProgress = Math.max(0, Math.min(100, Math.round(progress)));

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setLocalUrls(urls);
    return () =>
      urls.forEach((url) => {
        URL.revokeObjectURL(url);
      });
  }, [files]);

  const choose = (nextFiles: File[]) => {
    const accepted = nextFiles.filter((file) => fileMatchesAccept(file, accept));
    if (accepted.length !== nextFiles.length) {
      setValidationError("部分文件格式不符合当前上传要求");
    } else {
      setValidationError("");
    }
    const selected = multiple ? accepted : accepted.slice(0, 1);
    if (selected.length) onFilesChange(selected);
    if (inputRef.current) inputRef.current.value = "";
  };

  const openPicker = () => {
    if (!disabled && !uploading) inputRef.current?.click();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.key === "Enter" || event.key === " ") && !hasFiles) {
      event.preventDefault();
      openPicker();
    }
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (disabled || uploading) return;
    dragDepth.current += 1;
    setDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (!disabled && !uploading) choose(Array.from(event.dataTransfer.files));
  };

  return (
    <div className={cn("space-y-2", className)}>
      {label && <Label htmlFor={inputId}>{label}</Label>}
      <input
        {...props}
        ref={inputRef}
        id={inputId}
        type="file"
        className="sr-only"
        disabled={disabled || uploading}
        accept={accept}
        multiple={multiple}
        aria-describedby={descriptionId}
        onChange={(event) => choose(Array.from(event.currentTarget.files ?? []))}
      />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: The drop target becomes a keyboard button while empty and a media group after selection. */}
      <div
        className={cn(
          "min-h-28 rounded-lg border border-dashed border-line bg-surface p-4 transition-colors",
          !hasFiles && !disabled && !uploading && "cursor-pointer hover:border-primary/60 hover:bg-primary/[0.03]",
          dragging && "border-primary bg-primary/[0.06] ring-2 ring-primary/15",
          visibleError && "border-red-300",
          disabled && "opacity-50",
        )}
        role={!hasFiles ? "button" : undefined}
        tabIndex={!hasFiles && !disabled && !uploading ? 0 : undefined}
        onClick={!hasFiles ? openPicker : undefined}
        onKeyDown={handleKeyDown}
        onDragEnter={handleDragEnter}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {!hasFiles ? (
          <div className="flex min-h-20 flex-col items-center justify-center gap-2 text-center">
            <UploadCloud className="size-6 text-muted" aria-hidden="true" />
            <div>
              <b className="text-sm font-medium text-ink">
                {dragging ? "松开即可添加文件" : "拖拽文件到这里，或点击选择"}
              </b>
              {description && (
                <p id={descriptionId} className="mt-1 text-xs leading-5 text-muted">
                  {description}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <b className="block truncate text-sm font-medium text-ink">
                  {uploadedFiles.length && files.length
                    ? `${uploadedFiles.length} 个已上传，${files.length} 个待处理`
                    : uploadedFiles.length
                      ? `已上传 ${uploadedFiles.length} 个文件`
                      : files.length > 1
                        ? `已选择 ${files.length} 个文件`
                        : files[0]?.name}
                </b>
                <span className="text-xs text-muted">
                  {uploading
                    ? `正在上传 · ${normalizedProgress}%`
                    : visibleError
                      ? "上传未完成"
                      : uploadedFiles.length
                        ? "上传完成"
                        : "等待上传"}
                </span>
              </div>
              {!uploading && (
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={openPicker}>
                    重新选择
                  </Button>
                  {onClear && (
                    <Button variant="ghost" size="icon" aria-label="移除文件" onClick={onClear}>
                      <X />
                    </Button>
                  )}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {uploadedFiles.map((file) => (
                <div
                  key={file.id ?? file.url ?? file.name}
                  className="overflow-hidden rounded-md border border-line bg-surface-muted"
                >
                  <div className="flex aspect-video items-center justify-center overflow-hidden [&_audio]:w-[calc(100%-12px)] [&_img]:h-full [&_img]:w-full [&_img]:object-contain [&_video]:h-full [&_video]:w-full [&_video]:object-contain">
                    {file.url && /^(image|video|audio)\//.test(file.mimeType) ? (
                      <AuthenticatedMedia url={file.url} mimeType={file.mimeType} alt={file.name} />
                    ) : (
                      <FileText className="size-7 text-muted" aria-hidden="true" />
                    )}
                  </div>
                  <div className="px-2 py-1.5">
                    <b className="block truncate text-xs font-medium text-ink" title={file.name}>
                      {file.name}
                    </b>
                    <span className="text-2xs text-muted">{formatBytes(file.size) || file.mimeType}</span>
                  </div>
                </div>
              ))}
              {files.map((file, index) => (
                <div
                  key={`${file.name}-${file.size}-${file.lastModified}`}
                  className="overflow-hidden rounded-md border border-line bg-surface-muted"
                >
                  <div className="flex aspect-video items-center justify-center overflow-hidden [&_audio]:w-[calc(100%-12px)] [&_img]:h-full [&_img]:w-full [&_img]:object-contain [&_video]:h-full [&_video]:w-full [&_video]:object-contain">
                    {localUrls[index] ? <LocalMediaPreview file={file} url={localUrls[index]} /> : null}
                  </div>
                  <div className="px-2 py-1.5">
                    <b className="block truncate text-xs font-medium text-ink" title={file.name}>
                      {file.name}
                    </b>
                    <span className="text-2xs text-muted">{formatBytes(file.size)}</span>
                  </div>
                </div>
              ))}
            </div>
            {uploading && (
              <div
                className="space-y-1.5"
                role="progressbar"
                aria-label="文件上传进度"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={normalizedProgress}
              >
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-strong">
                  <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{ width: `${normalizedProgress}%` }}
                  />
                </div>
                <span className="inline-flex items-center gap-1.5 text-xs text-muted" role="status">
                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                  正在上传文件
                </span>
              </div>
            )}
          </div>
        )}
      </div>
      {visibleError && (
        <div className="flex items-center justify-between gap-3 text-xs text-red-600" role="alert">
          <span>{visibleError}</span>
          {onRetry && !uploading && (
            <Button variant="ghost" size="sm" onClick={onRetry}>
              <RotateCcw /> 重试
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
