import { useQuery } from "@tanstack/react-query";
import { type ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Clock3,
  Copy,
  Download,
  FileAudio2,
  FileVideo2,
  ImagePlus,
  LoaderCircle,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  UploadCloud,
  WandSparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  downloadAuthenticated,
  fetchAssetFolders,
  fetchJob,
  fetchJobs,
  fetchModels,
  requestCancel,
  requestRetry,
  setDefaultAssetFolder,
  submitJob,
  watchJob,
} from "@/api/api-client";
import type { Job, ModuleId, SeedanceModelId } from "@/api/generated/types.gen";
import type { FieldSpec, ModuleConfig } from "@/app/routes";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Slider } from "@/components/ui/slider";
import type { ApiJobResult, AssetFolder } from "@/entities/types";
import { db } from "@/lib/db";
import { cn } from "@/lib/utils";
import { AttachmentPicker } from "./attachment-picker";
import { AuthenticatedMedia } from "./authenticated-media";
import { ToolCreatorModal } from "./tool-creator-modal";
import { createToolTaskLabel, ToolTaskPage } from "./tool-task-page";

const statusMap: Record<Job["status"], string> = {
  queued: "排队中",
  processing: "生成中",
  succeeded: "已完成",
  partially_succeeded: "部分完成",
  failed: "失败",
  cancelled: "已取消",
};
const emptyJobs: Job[] = [];
const statusClassMap: Record<Job["status"], string> = {
  queued: "bg-surface-muted text-muted",
  processing: "bg-blue-50 text-blue-600",
  succeeded: "bg-emerald-50 text-emerald-700",
  partially_succeeded: "bg-amber-50 text-amber-700",
  failed: "bg-red-50 text-red-600",
  cancelled: "bg-surface-muted text-muted",
};
function UploadField({
  field,
  value,
  onChange,
}: {
  field: FieldSpec;
  value: string;
  onChange: (value: string) => void;
}) {
  const Icon = field.kind === "audio" ? FileAudio2 : field.kind === "image" ? ImagePlus : FileVideo2;
  const displayValue = value.startsWith("asset:") ? value.split(":").slice(2).join(":") : value;
  return (
    <AttachmentPicker
      accept={`${field.kind}/*`}
      trigger={(open) => (
        <button id={field.id} type="button" className="upload-zone" onClick={open}>
          <span className="upload-icon">{value ? <Icon size={22} /> : <UploadCloud size={22} />}</span>
          <span>
            <b>{displayValue || field.label}</b>
            <small>{value ? "已选择，点击可重新选择" : field.hint || "从素材库选择或从本地上传"}</small>
          </span>
          {value && <Check className="ml-auto text-emerald-600" size={20} />}
        </button>
      )}
      onSelect={([asset]) => asset && onChange(`asset:${asset.id}:${asset.name}`)}
    />
  );
}

function AssetGroupField({
  field,
  value,
  onChange,
}: {
  field: FieldSpec;
  value: string;
  onChange: (value: string) => void;
}) {
  let names: string[] = [];
  try {
    if (value.startsWith("assets:"))
      names = (JSON.parse(value.slice(7)) as Array<{ name: string }>).map((item) => item.name);
  } catch {
    names = [];
  }
  return (
    <AttachmentPicker
      multiple
      trigger={(open) => (
        <button id={field.id} type="button" className="asset-uploader" onClick={open}>
          <span className="asset-stack">
            <i />
            <i />
            <i />
          </span>
          <span>
            <b>{names.length ? `已选择 ${names.length} 个素材` : "选择任务素材"}</b>
            <small>{field.hint || "支持从素材库选择或本地批量上传"}</small>
          </span>
          <em>{names.length ? "重新选择" : "添加素材"}</em>
        </button>
      )}
      onSelect={(assets) =>
        onChange(
          `assets:${JSON.stringify(assets.map((asset) => ({ id: asset.id, name: asset.name, mimeType: asset.mimeType })))}`,
        )
      }
    />
  );
}

function BusinessField({
  field,
  value,
  onChange,
  invalid,
}: {
  field: FieldSpec;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
}) {
  const wrap = (control: React.ReactNode) => (
    <div className={`field ${invalid ? "field-invalid" : ""}`}>
      <label htmlFor={field.id}>
        {field.label}
        <em>{field.required ? "必填" : "可选"}</em>
      </label>
      {control}
      {field.hint && field.kind !== "video" && field.kind !== "audio" && (
        <small className="field-hint">{field.hint}</small>
      )}
      {invalid && <small className="field-error">请完成此项后再提交</small>}
    </div>
  );
  if (["video", "audio", "image"].includes(field.kind))
    return wrap(<UploadField field={field} value={value} onChange={onChange} />);
  if (field.kind === "asset-group") return wrap(<AssetGroupField field={field} value={value} onChange={onChange} />);
  if (field.kind === "segmented")
    return wrap(
      <div id={field.id} className="segmented">
        {field.options?.map((option) => (
          <button
            type="button"
            key={option}
            className={value === option ? "active" : ""}
            onClick={() => onChange(option)}
          >
            {option}
          </button>
        ))}
      </div>,
    );
  if (field.kind === "select")
    return wrap(
      <select id={field.id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="" disabled>
          请选择
        </option>
        {field.options?.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>,
    );
  if (field.kind === "textarea")
    return wrap(
      <textarea
        id={field.id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
      />,
    );
  if (field.kind === "number")
    return wrap(
      <div className="number-input">
        <button
          type="button"
          onClick={() => onChange(String(Math.max(field.min ?? 0, Number(value || field.min || 0) - 1)))}
        >
          −
        </button>
        <input
          id={field.id}
          type="number"
          min={field.min}
          max={field.max}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <span>{field.unit}</span>
        <button
          type="button"
          onClick={() => onChange(String(Math.min(field.max ?? 99, Number(value || field.min || 0) + 1)))}
        >
          ＋
        </button>
      </div>,
    );
  if (field.kind === "checkbox")
    return wrap(
      <button
        id={field.id}
        type="button"
        role="checkbox"
        aria-checked={value === "true"}
        className="check-field"
        onClick={() => onChange(value === "true" ? "" : "true")}
      >
        <i>{value === "true" && <Check size={13} />}</i>
        <span>{field.label}</span>
      </button>,
    );
  if (field.kind === "region")
    return wrap(
      <button id={field.id} type="button" className="region-picker" onClick={() => onChange("底部 24% 区域")}>
        <span className={value ? "selected" : ""} />
        <b>{value || "点击画面框选字幕区域"}</b>
      </button>,
    );
  return wrap(
    <input
      id={field.id}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder}
    />,
  );
}

function ToolboxUploadTile({
  field,
  value,
  onChange,
  multiple = false,
}: {
  field: FieldSpec;
  value: string;
  onChange: (value: string) => void;
  multiple?: boolean;
}) {
  const [preview, setPreview] = useState<{ name: string; mimeType: string; url?: string }>();
  const names = value.startsWith("assets:")
    ? (() => {
        try {
          return (JSON.parse(value.slice(7)) as Array<{ name: string }>).map((item) => item.name);
        } catch {
          return [];
        }
      })()
    : value.startsWith("asset:")
      ? [value.split(":").slice(2).join(":")]
      : [];
  const accept =
    field.kind === "audio" ? "audio/*" : field.kind === "image" ? "image/*" : multiple ? "video/*,image/*" : "video/*";
  return (
    <AttachmentPicker
      accept={accept}
      multiple={multiple}
      trigger={(open) => (
        <button
          type="button"
          className={cn(
            "tool-upload-tile !size-24 !rounded-md !border-line bg-white transition-colors hover:!bg-surface-muted",
            value && "has-file",
          )}
          onClick={open}
        >
          {preview?.url ? (
            <span className="tool-upload-preview">
              <AuthenticatedMedia url={preview.url} mimeType={preview.mimeType} alt={preview.name} controls={false} />
              <i>
                <Check />
              </i>
            </span>
          ) : value ? (
            <Check />
          ) : (
            <Plus />
          )}
          {names.length > 0 && !preview?.url && (
            <small>{names.length > 1 ? `已选择 ${names.length} 个素材` : names[0]}</small>
          )}
        </button>
      )}
      onSelect={(assets) => {
        if (multiple)
          onChange(
            `assets:${JSON.stringify(assets.map((asset) => ({ id: asset.id, name: asset.name, mimeType: asset.mimeType })))}`,
          );
        else if (assets[0]) {
          setPreview(assets[0]);
          onChange(`asset:${assets[0].id}:${assets[0].name}`);
        }
      }}
    />
  );
}

function ToolboxSwitch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value === "true"}
      className={cn(
        "relative h-5 w-9 rounded-full border-0 transition-colors",
        value === "true" ? "bg-primary" : "bg-line",
      )}
      onClick={() => onChange(value === "true" ? "" : "true")}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform",
          value === "true" && "translate-x-4",
        )}
      />
    </button>
  );
}

function ToolboxCreatorForm({
  config,
  values,
  setValue,
  submitted,
  running,
  hydrated,
  assetFolders,
  foldersLoading,
  onSetDefaultFolder,
  onCancel,
  onSubmit,
  error,
}: {
  config: ModuleConfig;
  values: Record<string, string>;
  setValue: (id: string, value: string) => void;
  submitted: boolean;
  running: boolean;
  hydrated: boolean;
  assetFolders: AssetFolder[];
  foldersLoading: boolean;
  onSetDefaultFolder: (folderId: string) => Promise<void>;
  onCancel: () => void;
  onSubmit: () => void;
  error?: string;
}) {
  const field = (id: string) => config.fields.find((item) => item.id === id) as FieldSpec;
  const requiredLabel = (text: string, required = false) => (
    <Label className="tool-form-label text-xs text-muted sm:justify-end">
      {required && <span className="text-red-500">*</span>}
      {text}
    </Label>
  );
  const select = (id: string, placeholder = "请选择") => {
    const item = field(id);
    return (
      <NativeSelect value={values[id] ?? ""} onChange={(event) => setValue(id, event.target.value)}>
        {!item.defaultValue && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {item.options?.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </NativeSelect>
    );
  };
  const segments = (id: string) => (
    <div className="tool-segments flex flex-wrap gap-1">
      {field(id).options?.map((option) => (
        <Button
          size="sm"
          variant={values[id] === option ? "default" : "outline"}
          key={option}
          onClick={() => setValue(id, option)}
        >
          {option}
        </Button>
      ))}
    </div>
  );
  const upload = (id: string, multiple = false) => (
    <ToolboxUploadTile
      field={field(id)}
      value={values[id] ?? ""}
      onChange={(value) => setValue(id, value)}
      multiple={multiple}
    />
  );
  const voiceFieldRequired = (id: string) => id === "synthesisText";
  const invalid = (id: string) =>
    submitted && (config.id === "voice-clone" ? voiceFieldRequired(id) : field(id).required) && !values[id];
  const orderedFolders = useMemo(() => {
    const result: Array<{ folder: AssetFolder; depth: number }> = [];
    const append = (parentId: string | undefined, depth: number) => {
      for (const folder of assetFolders.filter((item) => item.parentId === parentId)) {
        result.push({ folder, depth });
        append(folder.id, depth + 1);
      }
    };
    append(undefined, 0);
    return result;
  }, [assetFolders]);
  const selectedFolder = assetFolders.find((folder) => folder.id === values.saveLocation);
  const compactLabel = (text: string, required = false) => (
    <Label className="text-xs text-muted sm:justify-end">
      {required && <span className="text-red-500">*</span>}
      {text}
    </Label>
  );
  let content: React.ReactNode;

  if (config.id === "video-cut") {
    content = (
      <div className="flex w-full flex-col gap-3">
        <div className="grid items-center gap-2 sm:grid-cols-[96px_minmax(0,1fr)]">
          {compactLabel("分割策略", true)}
          <NativeSelect
            className={cn("h-8", invalid("method") && "border-red-500")}
            value={values.method ?? ""}
            onChange={(event) => setValue("method", event.target.value)}
          >
            {!field("method").defaultValue && (
              <option value="" disabled>
                请选择分割策略
              </option>
            )}
            {field("method").options?.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid min-h-8 items-center gap-2 sm:grid-cols-[96px_minmax(0,1fr)]">
          {compactLabel("自动保存")}
          <ToolboxSwitch value={values.autoSave ?? ""} onChange={(value) => setValue("autoSave", value)} />
        </div>
        <div className="grid items-start gap-2 sm:grid-cols-[96px_minmax(0,1fr)]">
          {compactLabel("保存位置", true)}
          <div className="flex min-w-0 items-center gap-2">
            <NativeSelect
              className={cn("h-8", invalid("saveLocation") && "border-red-500")}
              value={values.saveLocation ?? ""}
              onChange={(event) => setValue("saveLocation", event.target.value)}
            >
              <option value="" disabled>
                {foldersLoading ? "正在加载我的文件夹…" : "请选择我的文件夹"}
              </option>
              {orderedFolders.map(({ folder, depth }) => (
                <option key={folder.id} value={folder.id}>
                  {`${"　".repeat(depth)}${folder.name}${folder.isDefault ? "（默认）" : ""}`}
                </option>
              ))}
            </NativeSelect>
            <Button
              className="h-7 px-2 text-xs"
              size="sm"
              variant="ghost"
              disabled={!selectedFolder || selectedFolder.isDefault}
              onClick={() => selectedFolder && void onSetDefaultFolder(selectedFolder.id)}
            >
              {selectedFolder?.isDefault ? "当前默认" : "设为默认"}
            </Button>
          </div>
        </div>
        <div
          className={cn(
            "grid items-start gap-2 sm:grid-cols-[96px_minmax(0,1fr)] [&_.tool-upload-tile]:!size-24",
            invalid("source") && "[&_.tool-upload-tile]:!border-red-500",
          )}
        >
          {compactLabel("选择视频", true)}
          <div>{upload("source")}</div>
        </div>
      </div>
    );
  } else if (config.id === "video-mashup") {
    content = (
      <div className="tool-simple-form space-y-1">
        <div className={`tool-form-row ${invalid("taskName") ? "invalid" : ""}`}>
          {requiredLabel("任务名称", true)}
          <Input value={values.taskName ?? ""} onChange={(event) => setValue("taskName", event.target.value)} />
        </div>
        <div className="tool-form-row">
          {requiredLabel("画面类型", true)}
          {select("pictureType")}
        </div>
        <div className="tool-form-row">
          {requiredLabel("分镜贴纸")}
          <ToolboxSwitch value={values.shotSticker ?? ""} onChange={(value) => setValue("shotSticker", value)} />
        </div>
        <div className={`tool-form-row upload-row ${invalid("assets") ? "invalid" : ""}`}>
          {requiredLabel("选择素材", true)}
          {upload("assets", true)}
        </div>
        <div className="tool-form-row">
          {requiredLabel("组合模式")}
          {segments("combinationMode")}
        </div>
        <div className="tool-form-row">
          {requiredLabel("分辨率")}
          {segments("resolution")}
        </div>
        <div className="tool-form-row">
          {requiredLabel("最多生成数量")}
          <Input
            type="number"
            min="1"
            max="20"
            value={values.count ?? "1"}
            onChange={(event) => setValue("count", event.target.value)}
          />
        </div>
        <div className={`tool-form-row ${invalid("saveLocation") ? "invalid" : ""}`}>
          {requiredLabel("保存位置", true)}
          {select("saveLocation")}
        </div>
        <div className="tool-form-row">
          {requiredLabel("自动采纳")}
          <ToolboxSwitch value={values.autoAccept ?? ""} onChange={(value) => setValue("autoAccept", value)} />
        </div>
        <div className="tool-form-row">
          {requiredLabel("全局贴纸")}
          <ToolboxSwitch value={values.globalSticker ?? ""} onChange={(value) => setValue("globalSticker", value)} />
        </div>
      </div>
    );
  } else if (config.id === "voice-clone") {
    content = (
      <div className="tool-simple-form voice-clone-form">
        <div className="tool-form-row combo-summary">
          {requiredLabel("配音音色")}
          <span>
            <b>系统预设音色</b>
            <small>无需配置音色参数</small>
          </span>
        </div>
        <div className={`tool-form-row textarea-row ${invalid("synthesisText") ? "invalid" : ""}`}>
          {requiredLabel("合成文本", true)}
          <div>
            <textarea
              maxLength={1000}
              value={values.synthesisText ?? ""}
              placeholder="输入要生成语音的文本"
              onChange={(event) => setValue("synthesisText", event.target.value)}
            />
            <small>{(values.synthesisText ?? "").length} / 1000</small>
          </div>
        </div>
        <div className="tool-form-row">
          {requiredLabel("语言")}
          {select("synthesisLanguage")}
        </div>
        <div className="tool-form-row">
          {requiredLabel("配音风格")}
          {select("synthesisStyle")}
        </div>
        <div className="tool-form-row">
          {requiredLabel("语速")}
          <div className="flex min-w-0 items-center gap-4">
            <Slider
              aria-label="语速"
              min={-50}
              max={100}
              step={1}
              value={[Number(values.speechRate ?? 0)]}
              onValueChange={([value]) => setValue("speechRate", String(value ?? 0))}
            />
            <output className="w-20 shrink-0 text-right text-sm text-muted">
              {Number(values.speechRate ?? 0) === 0 ? "正常" : `${values.speechRate}%`}
            </output>
          </div>
        </div>
      </div>
    );
  } else if (config.id === "video-renewal") {
    content = (
      <div className="tool-simple-form renewal-form">
        <div className="tool-form-row compact-row">
          {requiredLabel("自动保存")}
          <ToolboxSwitch value={values.autoSave ?? ""} onChange={(value) => setValue("autoSave", value)} />
        </div>
        <div className={`tool-form-row upload-row ${invalid("source") ? "invalid" : ""}`}>
          {requiredLabel("选择视频", true)}
          {upload("source")}
        </div>
      </div>
    );
  } else if (config.id === "subtitle-erase") {
    content = (
      <div className="tool-simple-form subtitle-settings">
        <div className="tool-form-row combo-summary">
          {requiredLabel("处理方式")}
          <span>
            <b>精细化自动擦除</b>
            <small>自动识别字幕并逐帧补全背景</small>
          </span>
        </div>
        <div className={`tool-form-row upload-row ${invalid("source") ? "invalid" : ""}`}>
          {requiredLabel("选择视频", true)}
          {upload("source")}
        </div>
      </div>
    );
  } else if (config.id === "video-enhancement") {
    content = (
      <div className="tool-simple-form enhancement-form">
        <div className="tool-form-row combo-summary">
          {requiredLabel("处理方式")}
          <span>
            <b>极速画质增强</b>
            <small>自动改善清晰度、噪点和画面质感</small>
          </span>
        </div>
        <div className={`tool-form-row upload-row ${invalid("source") ? "invalid" : ""}`}>
          {requiredLabel("选择视频", true)}
          {upload("source")}
        </div>
      </div>
    );
  } else {
    content = (
      <div className="tool-simple-form kickart-form">
        <div className="tool-form-row">
          {requiredLabel("模式", true)}
          {segments("mode")}
        </div>
        <div className={`tool-form-row upload-row ${invalid("master") ? "invalid" : ""}`}>
          {requiredLabel("参考视频", true)}
          {upload("master")}
        </div>
        <div className="tool-form-row product-mode-row">
          {requiredLabel("商品信息")}
          {segments("productType")}
        </div>
        <div className={`tool-form-row upload-row ${invalid("productImage") ? "invalid" : ""}`}>
          {requiredLabel("商品图")}
          {upload("productImage")}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm max-sm:[&_.tool-form-label]:!justify-start max-sm:[&_.tool-form-row]:!grid-cols-1 [&_.mashup-form]:!grid-cols-1 [&_.mashup-left]:!border-0 [&_.mashup-left]:!p-0 [&_.mashup-right]:!p-0 [&_.tool-form-label]:!justify-end [&_.tool-form-label]:!text-xs [&_.tool-form-label]:!text-muted [&_.tool-form-row]:!min-h-10 [&_.tool-form-row]:!grid-cols-[96px_minmax(0,1fr)] [&_.tool-form-row]:!gap-3 [&_.tool-simple-form]:!mx-auto [&_.tool-simple-form]:!w-full [&_.tool-simple-form]:!max-w-2xl [&_.tool-simple-form]:!p-0 [&_input:not([type=range])]:!h-8 [&_input:not([type=range])]:!rounded-md [&_input:not([type=range])]:!border-line [&_input:not([type=range])]:!px-3 [&_select]:!h-8 [&_textarea]:!rounded-md [&_textarea]:!border-line [&_textarea]:!p-3">
        {content}
      </div>
      {error && <div className="border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-600">{error}</div>}
      <footer className="flex h-13 flex-none items-center justify-end gap-2 border-t border-line px-4">
        <Button size="sm" variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button size="sm" disabled={running || !hydrated} onClick={onSubmit}>
          {running ? <LoaderCircle className="animate-spin" /> : null}
          {running ? "提交中…" : "确定"}
        </Button>
      </footer>
    </>
  );
}

function TaskTable({
  tasks,
  retry,
  preview,
  cancel,
  className,
  height,
  emptyMessage,
  emptyAction,
}: {
  tasks: Job[];
  retry: (t: Job) => void;
  preview: (t: Job) => void;
  cancel: (t: Job) => void;
  className?: string;
  height?: string;
  emptyMessage?: string;
  emptyAction?: React.ReactNode;
}) {
  const column = createColumnHelper<Job>();
  const columns = useMemo(
    () => [
      column.accessor("title", {
        header: "任务名称",
        size: 260,
        cell: (i) => (
          <div>
            <b className="text-xs font-medium text-ink">{i.getValue()}</b>
            <small className="mt-0.5 block text-2xs text-muted">
              {new Date(i.row.original.createdAt).toLocaleString()} ·{" "}
              {i.row.original.overallExecutionMode === "mock"
                ? "模拟"
                : i.row.original.overallExecutionMode === "local"
                  ? "本地"
                  : i.row.original.overallExecutionMode === "mixed"
                    ? "混合"
                    : "真实"}
            </small>
          </div>
        ),
      }),
      column.accessor("status", {
        header: "状态",
        size: 110,
        cell: (i) => (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-1 text-2xs",
              statusClassMap[i.getValue()],
            )}
          >
            {i.getValue() === "processing" && <LoaderCircle size={13} className="animate-spin" />}
            {statusMap[i.getValue()]}
          </span>
        ),
      }),
      column.accessor("progress", {
        header: "进度",
        size: 170,
        cell: (i) => (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-muted">
              <span className="block h-full rounded-full bg-primary" style={{ width: `${i.getValue()}%` }} />
            </div>
            <span className="text-2xs text-muted">{i.getValue()}%</span>
          </div>
        ),
      }),
      column.display({
        id: "resultCount",
        header: "结果数",
        size: 80,
        cell: (i) => i.row.original.result?.artifacts.length ?? "—",
      }),
      column.display({
        id: "creator",
        header: "创建人",
        size: 100,
        cell: () => "当前用户",
      }),
      column.display({
        id: "createdAt",
        header: "创建时间",
        size: 170,
        cell: (i) => new Date(i.row.original.createdAt).toLocaleString(),
      }),
      column.display({
        id: "updatedAt",
        header: "更新时间",
        size: 170,
        cell: (i) => new Date(i.row.original.updatedAt).toLocaleString(),
      }),
      column.display({
        id: "actions",
        header: "操作",
        size: 210,
        cell: (i) => (
          <div className="flex items-center gap-1">
            {i.row.original.status === "succeeded" || i.row.original.status === "partially_succeeded" ? (
              <>
                <Button
                  className="h-7 px-2 text-2xs text-primary"
                  size="sm"
                  variant="ghost"
                  onClick={() => preview(i.row.original)}
                >
                  <Play size={14} />
                  查看结果
                </Button>
                {i.row.original.status === "partially_succeeded" ? (
                  <Button
                    className="h-7 px-2 text-2xs text-primary"
                    size="sm"
                    variant="ghost"
                    onClick={() => retry(i.row.original)}
                  >
                    <RotateCcw size={14} />
                    重试未完成
                  </Button>
                ) : (
                  <Button
                    className="h-7 px-2 text-2xs text-primary"
                    size="sm"
                    variant="ghost"
                    onClick={() => preview(i.row.original)}
                  >
                    <Download size={14} />
                    导出
                  </Button>
                )}
              </>
            ) : i.row.original.status === "failed" || i.row.original.status === "cancelled" ? (
              <Button
                className="h-7 px-2 text-2xs text-primary"
                size="sm"
                variant="ghost"
                onClick={() => retry(i.row.original)}
              >
                <RotateCcw size={14} />
                重试
              </Button>
            ) : (
              <Button
                className="h-7 px-2 text-2xs text-primary"
                size="sm"
                variant="ghost"
                onClick={() => cancel(i.row.original)}
              >
                <X size={14} />
                取消
              </Button>
            )}
          </div>
        ),
      }),
    ],
    [column, retry, preview, cancel],
  );
  return (
    <DataTable
      className={className}
      columns={columns as ColumnDef<Job, unknown>[]}
      data={tasks}
      getRowId={(task) => task.id}
      emptyMessage={emptyMessage}
      emptyIcon={<X />}
      emptyAction={emptyAction}
      height={height}
    />
  );
}

export function resultMediaArtifacts(result: ApiJobResult | undefined) {
  return result?.artifacts.filter((artifact) => /^(video|audio|image)\//.test(artifact.mimeType)) ?? [];
}

function ResultPreview({
  task,
  config,
  selectedArtifactIds,
  onToggleArtifact,
}: {
  task: Job;
  config: ModuleConfig;
  selectedArtifactIds: string[];
  onToggleArtifact: (artifactId: string) => void;
}) {
  const result = task.result as ApiJobResult | undefined;
  const mediaArtifacts = resultMediaArtifacts(result);
  const media = mediaArtifacts[0];
  const text = result?.artifacts.find((artifact) => artifact.text)?.text;
  if (result?.kind === "video-cut" && mediaArtifacts.length)
    return (
      <div className="result-preview result-clips">
        <div className="result-clip-grid">
          {mediaArtifacts.map((artifact, index) => (
            <article
              className={`result-clip-card ${selectedArtifactIds.includes(artifact.id) ? "selected" : ""}`}
              key={artifact.id}
            >
              <button
                type="button"
                className="result-clip-selector"
                aria-label={`${selectedArtifactIds.includes(artifact.id) ? "取消选择" : "选择"}${artifact.name}`}
                aria-pressed={selectedArtifactIds.includes(artifact.id)}
                onClick={() => onToggleArtifact(artifact.id)}
              >
                {selectedArtifactIds.includes(artifact.id) && <Check />}
              </button>
              <div className={`result-clip-media${artifact.mimeType.startsWith("video/") ? " result-clip-video" : ""}`}>
                {artifact.url ? (
                  <AuthenticatedMedia url={artifact.url} mimeType={artifact.mimeType} alt={artifact.name} />
                ) : (
                  <config.icon size={32} />
                )}
              </div>
              <small title={artifact.name}>
                <b>{String(index + 1).padStart(2, "0")}</b>
                {artifact.name}
              </small>
            </article>
          ))}
        </div>
        <p>
          已选择 {selectedArtifactIds.length}/{mediaArtifacts.length} ·{" "}
          {result?.summary ?? `共生成 ${mediaArtifacts.length} 个镜头片段`}
        </p>
      </div>
    );
  return (
    <div className={`result-preview result-${config.result.kind}`}>
      {media?.url ? (
        <AuthenticatedMedia url={media.url} mimeType={media.mimeType} alt={task.title} />
      ) : (
        <>
          <config.icon size={48} />
          <Sparkles size={20} />
        </>
      )}
      <b>{task.title}</b>
      <span>{text || result?.summary || "结果已生成，可继续进入下游工作流"}</span>
    </div>
  );
}

function AssetStrip({ onSelect }: { onSelect: (asset: { id: number; name: string }) => void }) {
  const parent = useRef<HTMLDivElement>(null);
  const assets = Array.from({ length: 80 }, (_, i) => ({ id: i, name: `灵感素材 ${String(i + 1).padStart(2, "0")}` }));
  const virtual = useVirtualizer({
    horizontal: true,
    count: assets.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 132,
    overscan: 5,
  });
  return (
    <div ref={parent} className="asset-strip">
      <div style={{ width: virtual.getTotalSize(), height: 92, position: "relative" }}>
        {virtual.getVirtualItems().map((v) => (
          <button
            type="button"
            className="asset-card"
            key={v.key}
            style={{ transform: `translateX(${v.start}px)` }}
            onClick={() => onSelect(assets[v.index])}
          >
            <ImagePlus size={20} />
            <span>{assets[v.index].name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ModulePage({ config }: { config: ModuleConfig }) {
  const newTaskLabel = createToolTaskLabel(config.label);
  const initialValues = () =>
    Object.fromEntries(
      config.fields.map((field) => [
        field.id,
        field.defaultValue ??
          (field.kind === "number"
            ? String(field.min ?? 1)
            : field.kind === "segmented"
              ? (field.options?.[0] ?? "")
              : ""),
      ]),
    );
  const [tasks, setTasks] = useState<Job[]>([]);
  const [running, setRunning] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [scenario, setScenario] = useState("success");
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [hydrated, setHydrated] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Job | null>(null);
  const [selectedArtifactIds, setSelectedArtifactIds] = useState<string[]>([]);
  const [resultActionRunning, setResultActionRunning] = useState(false);
  const [apiError, setApiError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [videoModel, setVideoModel] = useState<SeedanceModelId>("doubao-seedance-2-0-fast-260128");
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [appliedFilters, setAppliedFilters] = useState({ name: "", status: "", from: "", to: "" });
  const setValue = (id: string, value: string) => setValues((old) => ({ ...old, [id]: value }));
  const { data: restored = emptyJobs } = useQuery({
    queryKey: ["api-tasks", config.id],
    queryFn: () => fetchJobs(config.id as ModuleId),
    refetchInterval: 5000,
  });
  const { data: modelCatalog = [] } = useQuery({ queryKey: ["api-models"], queryFn: fetchModels, staleTime: 60_000 });
  const {
    data: assetFolders = [],
    isLoading: foldersLoading,
    refetch: refetchAssetFolders,
  } = useQuery({
    queryKey: ["asset-folders"],
    queryFn: fetchAssetFolders,
    enabled: config.id === "video-cut",
  });
  useEffect(() => setTasks(restored), [restored]);
  useEffect(() => {
    const result = selectedTask?.result as ApiJobResult | undefined;
    setSelectedArtifactIds(
      config.id === "video-cut" ? resultMediaArtifacts(result).map((artifact) => artifact.id) : [],
    );
  }, [config.id, selectedTask?.id]);
  useEffect(() => {
    if (config.id !== "video-cut" || !hydrated || !assetFolders.length) return;
    setValues((current) => {
      if (assetFolders.some((folder) => folder.id === current.saveLocation)) return current;
      const preferred = assetFolders.find((folder) => folder.isDefault) ?? assetFolders[0];
      return { ...current, saveLocation: preferred.id };
    });
  }, [assetFolders, config.id, hydrated]);
  useEffect(() => {
    const cleanups = tasks
      .filter((task) => task.status === "queued" || task.status === "processing")
      .map((task) =>
        watchJob(
          task.id,
          (updated) => setTasks((old) => [updated, ...old.filter((item) => item.id !== updated.id)]),
          () =>
            void fetchJob(task.id).then((updated) =>
              setTasks((old) => [updated, ...old.filter((item) => item.id !== updated.id)]),
            ),
        ),
      );
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [tasks.map((task) => `${task.id}:${task.status}`).join("|")]);
  useEffect(() => {
    let active = true;
    setHydrated(false);
    void db.drafts.get(config.id).then((draft) => {
      if (!active) return;
      setValues({ ...initialValues(), ...(draft?.values ?? {}) });
      setHydrated(true);
    });
    return () => {
      active = false;
    };
  }, [config.id]);
  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => void db.drafts.put({ id: config.id, values, updatedAt: Date.now() }), 250);
    return () => clearTimeout(timer);
  }, [config.id, hydrated, values]);
  useEffect(() => {
    if (!creatorOpen || config.id !== "video-mashup" || values.taskName) return;
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    setValue(
      "taskName",
      `混剪_${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}_${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
    );
  }, [config.id, creatorOpen, values.taskName]);
  const splitAt = Math.ceil(config.fields.length / 2);
  const stepFields = [config.fields.slice(0, splitAt), config.fields.slice(splitAt)];
  const visibleFields = stepFields[currentStep] ?? [];
  const fieldRequired = (field: FieldSpec) => {
    if (config.id !== "voice-clone") return Boolean(field.required);
    return field.id === "synthesisText";
  };
  const missing = config.fields.filter((field) => fieldRequired(field) && !values[field.id]);
  const missingVisible = visibleFields.filter((field) => fieldRequired(field) && !values[field.id]);
  const next = () => {
    setSubmitted(true);
    if (missingVisible.length) return;
    setSubmitted(false);
    setCurrentStep((step) => Math.min(2, step + 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const back = () => {
    setSubmitted(false);
    setCurrentStep((step) => Math.max(0, step - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const usesSeedance = config.id === "ai-generate" && values.type === "视频";
  const localVideoModules = new Set<ModuleId>([
    "video-create",
    "video-cut",
    "video-mashup",
    "video-renewal",
    "subtitle-erase",
    "video-enhancement",
    "kickart",
  ]);
  const selectableModels = modelCatalog.filter((model) => model.capability === "video-generate" && model.enabled);
  const filteredTasks = tasks.filter(
    (task) =>
      (!appliedFilters.name || task.title.toLowerCase().includes(appliedFilters.name.toLowerCase())) &&
      (!appliedFilters.status || task.status === appliedFilters.status) &&
      (!appliedFilters.from || new Date(task.createdAt) >= new Date(`${appliedFilters.from}T00:00:00`)) &&
      (!appliedFilters.to || new Date(task.createdAt) <= new Date(`${appliedFilters.to}T23:59:59.999`)),
  );
  const submit = async () => {
    setSubmitted(true);
    if (missing.length) return;
    setRunning(true);
    setApiError("");
    try {
      const submittedValues = config.id === "video-cut" ? { ...values, outputFolderId: values.saveLocation } : values;
      const generatedTitle = `${config.label} · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      const job = await submitJob(
        config.id as ModuleId,
        config.id === "voice-clone" ? generatedTitle : values.taskName || generatedTitle,
        { ...submittedValues, __scenario: scenario },
        usesSeedance ? videoModel : undefined,
      );
      setTasks((old) => [job, ...old.filter((x) => x.id !== job.id)]);
      setCreatorOpen(false);
      setCurrentStep(0);
      setSubmitted(false);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "任务提交失败");
    } finally {
      setRunning(false);
    }
  };
  const setDefaultOutputFolder = async (folderId: string) => {
    setApiError("");
    try {
      await setDefaultAssetFolder(folderId);
      await refetchAssetFolders();
      setActionNotice("默认保存文件夹已更新");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "默认文件夹设置失败");
    }
  };
  const retry = (task: Job) => {
    void requestRetry(task.id)
      .then((job) => setTasks((old) => [job, ...old.filter((x) => x.id !== job.id)]))
      .catch((error) => setApiError(error instanceof Error ? error.message : "重试失败"));
  };
  const cancel = (task: Job) => {
    void requestCancel(task.id)
      .then((job) => setTasks((old) => old.map((item) => (item.id === job.id ? job : item))))
      .catch((error) => setApiError(error instanceof Error ? error.message : "取消失败"));
  };
  const handleResultAction = async (action: string) => {
    if (!selectedTask) return;
    const result = selectedTask.result as ApiJobResult | undefined;
    const artifact = result?.artifacts?.[0];
    const mediaArtifacts = resultMediaArtifacts(result);
    const selectedArtifacts = mediaArtifacts.filter((item) => selectedArtifactIds.includes(item.id));
    if (action === "再次生成") {
      setValues({
        ...initialValues(),
        ...selectedTask.values,
        operation: "synthesize",
        voiceSource: "preset",
        presetVoiceId: "zh_female_vv_uranus_bigtts",
        parentJobId: "",
      });
      setSelectedTask(null);
      setSubmitted(false);
      setCreatorOpen(true);
      return;
    }
    if (action === "批量选择") {
      setSelectedArtifactIds(
        selectedArtifacts.length === mediaArtifacts.length ? [] : mediaArtifacts.map((item) => item.id),
      );
      setActionNotice(selectedArtifacts.length === mediaArtifacts.length ? "已取消全部选择" : "已选择全部切片");
      return;
    }
    if (["下载选中", "加入素材库", "合并片段"].includes(action) && !selectedArtifacts.length) {
      setApiError("请先选择至少一个切片");
      return;
    }
    if (action === "下载选中") {
      setResultActionRunning(true);
      setApiError("");
      try {
        for (const selected of selectedArtifacts)
          if (selected.url) await downloadAuthenticated(selected.url, selected.name);
        setActionNotice(`已开始下载 ${selectedArtifacts.length} 个切片`);
      } catch (error) {
        setApiError(error instanceof Error ? error.message : "切片下载失败");
      } finally {
        setResultActionRunning(false);
      }
      return;
    }
    if (action === "加入素材库") {
      const folderId = selectedTask.values.outputFolderId;
      const params = new URLSearchParams();
      if (folderId) params.set("folderId", folderId);
      params.set("assetIds", selectedArtifacts.map((item) => item.id).join(","));
      window.location.assign(`/assets/materials?${params}`);
      return;
    }
    if (action === "合并片段") {
      if (selectedArtifacts.length < 2) {
        setApiError("至少选择两个切片才能合并");
        return;
      }
      setResultActionRunning(true);
      setApiError("");
      try {
        const mergeJob = await submitJob("video-cut", `${selectedTask.title} · 合并`, {
          assets: `assets:${JSON.stringify(
            selectedArtifacts.map((item) => ({ id: item.id, name: item.name, mimeType: item.mimeType })),
          )}`,
          mergeMode: "video-cut-clips",
          sourceVideoCutJobId: selectedTask.id,
          outputFolderId: selectedTask.values.outputFolderId ?? "",
        });
        setTasks((current) => [mergeJob, ...current.filter((item) => item.id !== mergeJob.id)]);
        setSelectedTask(null);
        setActionNotice("合并任务已提交，可在当前任务列表查看进度");
        setResultActionRunning(false);
      } catch (error) {
        setApiError(error instanceof Error ? error.message : "合并任务创建失败");
        setResultActionRunning(false);
      }
      return;
    }
    if (action.includes("复制")) {
      await navigator.clipboard.writeText(result?.summary ?? artifact?.text ?? "");
      setActionNotice("内容已复制到剪贴板");
      return;
    }
    if (action.includes("下载") || action.includes("导出")) {
      if (artifact?.url) await downloadAuthenticated(artifact.url, artifact.name);
      else {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(
          new Blob([artifact?.text ?? result?.summary ?? ""], { type: artifact?.mimeType ?? "text/plain" }),
        );
        link.download = artifact?.name ?? `${config.id}-result.txt`;
        link.click();
      }
      setActionNotice("已开始下载结果");
      return;
    }
    if (action.includes("一键成片")) {
      window.location.href = "/aigc/video-create";
      return;
    }
    if (action.includes("用于混剪")) {
      window.location.href = "/tools/video-mashup";
      return;
    }
    if (action.includes("收藏") || action.includes("设为常用")) {
      setActionNotice(`${action}成功`);
      return;
    }
    if (action.includes("删除")) {
      setSelectedTask(null);
      setTasks((old) => old.filter((item) => item.id !== selectedTask.id));
      setActionNotice("已从当前列表移除");
      return;
    }
    if (/再次|重新|调整|改写|变体|替换|编辑|继续/.test(action)) {
      setSelectedTask(null);
      setCurrentStep(0);
      setCreatorOpen(true);
      setActionNotice(`已进入“${action}”配置状态`);
      return;
    }
    setActionNotice(`${action}已打开，可继续查看结果细节`);
  };
  return (
    <div className="!m-0 !max-w-none !bg-white !p-0">
      <ToolCreatorModal open={creatorOpen} title={newTaskLabel} onClose={() => setCreatorOpen(false)}>
        <div className="flex min-h-0 flex-1 flex-col">
          <ToolboxCreatorForm
            config={config}
            values={values}
            setValue={setValue}
            submitted={submitted}
            running={running}
            hydrated={hydrated}
            assetFolders={assetFolders}
            foldersLoading={foldersLoading}
            onSetDefaultFolder={setDefaultOutputFolder}
            onCancel={() => setCreatorOpen(false)}
            onSubmit={() => void submit()}
            error={apiError}
          />
          {false && (
            <>
              <div className="workspace-grid legacy-creator-body" aria-hidden="true">
                <section className="work-card">
                  <div className="steps">
                    {config.steps.map((step, index) => (
                      <button
                        type="button"
                        className={index === currentStep ? "active" : index < currentStep ? "done" : ""}
                        key={step}
                        onClick={() => index < currentStep && setCurrentStep(index)}
                      >
                        <i>{index < currentStep ? <Check size={12} /> : index + 1}</i>
                        {step}
                        {index < config.steps.length - 1 && <ChevronRight />}
                      </button>
                    ))}
                  </div>
                  {currentStep < 2 ? (
                    <div className="form-stack">
                      {hydrated ? (
                        visibleFields.map((field) => (
                          <BusinessField
                            key={field.id}
                            field={field}
                            value={values[field.id] ?? ""}
                            onChange={(value) => setValue(field.id, value)}
                            invalid={Boolean(submitted && field.required && !values[field.id])}
                          />
                        ))
                      ) : (
                        <>
                          <div className="form-skeleton" />
                          <div className="form-skeleton" />
                          <div className="form-skeleton wide" />
                        </>
                      )}
                      {usesSeedance && (
                        <div className="engine-panel">
                          <span>视频生成引擎</span>
                          <div className="model-cards">
                            {selectableModels.map((model) => (
                              <button
                                type="button"
                                key={model.id}
                                className={videoModel === model.id ? "active" : ""}
                                onClick={() => setVideoModel(model.id as SeedanceModelId)}
                              >
                                <b>{model.name}</b>
                                <small>{model.description}</small>
                                <em>{model.tags.join(" · ")}</em>
                              </button>
                            ))}
                          </div>
                          {!selectableModels.length && (
                            <small className="field-error">
                              三款 Seedance 尚未全部通过真实基线测试，当前不可提交真实视频生成。
                            </small>
                          )}
                        </div>
                      )}
                      {localVideoModules.has(config.id) && (
                        <div className="engine-panel local-engine">
                          <span>生成引擎</span>
                          <b>本地处理，不使用视频生成模型</b>
                          <small>该工具使用 FFmpeg 或本地滤镜，不会发起 Seedance 付费请求。</small>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="review-panel">
                      <div className="review-head">
                        <span>
                          <Check size={18} />
                        </span>
                        <div>
                          <h3>确认创作配置</h3>
                          <p>检查以下信息，确认后任务将进入异步生成队列。</p>
                        </div>
                      </div>
                      <dl>
                        {config.fields.map((field) => (
                          <div key={field.id}>
                            <dt>{field.label}</dt>
                            <dd>{values[field.id] || "未设置"}</dd>
                          </div>
                        ))}
                        {usesSeedance && (
                          <div>
                            <dt>视频模型</dt>
                            <dd>{selectableModels.find((model) => model.id === videoModel)?.name ?? videoModel}</dd>
                          </div>
                        )}
                      </dl>
                      <button type="button" className="edit-config" onClick={() => setCurrentStep(0)}>
                        返回修改内容
                      </button>
                    </div>
                  )}
                  {currentStep === 1 && (
                    <>
                      <button className="advanced" onClick={() => setAdvanced((v) => !v)}>
                        <span>高级设置</span>
                        <small>{advanced ? "收起" : "展开更多生成参数"}</small>
                      </button>
                      {advanced && (
                        <div className="advanced-panel">
                          <label>
                            生成策略
                            <select>
                              <option>创意优先</option>
                              <option>稳定优先</option>
                            </select>
                          </label>
                          <label>
                            测试场景
                            <select value={scenario} onChange={(e) => setScenario(e.target.value)}>
                              <option value="success">正常完成</option>
                              <option value="fail-analysis">素材分析失败</option>
                              <option value="partial-batch">批量任务部分成功</option>
                              <option value="insufficient-credits">创作点不足</option>
                            </select>
                          </label>
                        </div>
                      )}
                    </>
                  )}
                  {apiError && <div className="field-error">{apiError}</div>}
                  <div className="submit-bar">
                    <div>
                      <b>
                        {currentStep === 2 ? `预计消耗 ${config.cost} 创作点` : `第 ${currentStep + 1} 步，共 3 步`}
                      </b>
                      <small>
                        {hydrated ? "已自动保存草稿" : "正在恢复草稿…"} · {config.duration}
                      </small>
                    </div>
                    <div className="wizard-actions">
                      {currentStep > 0 && (
                        <button type="button" className="secondary" onClick={back}>
                          <ArrowLeft />
                          上一步
                        </button>
                      )}
                      {currentStep < 2 ? (
                        <button type="button" disabled={!hydrated} onClick={next}>
                          下一步
                          <ArrowRight />
                        </button>
                      ) : (
                        <button
                          disabled={running || !hydrated || (usesSeedance && !selectableModels.length)}
                          onClick={submit}
                        >
                          {running ? <LoaderCircle className="animate-spin" /> : <WandSparkles />}
                          {running ? "正在提交…" : config.action}
                        </button>
                      )}
                    </div>
                  </div>
                </section>
                <aside className="guide-card">
                  <div className="visual">
                    <config.icon size={42} />
                    <span />
                    <span />
                  </div>
                  <h3>获得更好的结果</h3>
                  <ol>
                    {config.tips.map((tip) => (
                      <li key={tip}>{tip}</li>
                    ))}
                  </ol>
                  <div className="safe-note">
                    <Clock3 size={17} />
                    <span>
                      <b>异步生成</b>
                      <small>{config.duration}</small>
                    </span>
                  </div>
                </aside>
              </div>
              {config.id === "ai-generate" && (
                <section className="asset-section">
                  <div className="section-title">
                    <div>
                      <span>灵感素材</span>
                      <h2>从已有素材开始</h2>
                    </div>
                    <button type="button" onClick={() => setActionNotice("素材库已展开，可点击下方素材引用")}>
                      查看素材库
                    </button>
                  </div>
                  <AssetStrip
                    onSelect={(asset) => {
                      setValue(
                        "references",
                        `assets:${JSON.stringify([{ id: `library-${asset.id}`, name: asset.name, mimeType: "image/png" }])}`,
                      );
                      setActionNotice(`已引用 ${asset.name}`);
                    }}
                  />
                </section>
              )}
              {actionNotice && (
                <div className="safe-note">
                  <Sparkles size={17} />
                  <span>
                    <b>{actionNotice}</b>
                    <small>操作已完成</small>
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </ToolCreatorModal>
      <ToolTaskPage
        actionLabel={newTaskLabel}
        onAction={() => setCreatorOpen(true)}
        onSearch={setAppliedFilters}
        count={filteredTasks.length}
        totalCount={tasks.length}
      >
        <TaskTable
          tasks={filteredTasks}
          retry={retry}
          preview={setSelectedTask}
          cancel={cancel}
          className="min-h-0 flex-1"
          height="100%"
          emptyMessage={tasks.length ? "没有符合条件的任务" : "暂无任务"}
          emptyAction={
            !tasks.length ? (
              <Button size="sm" onClick={() => setCreatorOpen(true)}>
                {newTaskLabel}
              </Button>
            ) : undefined
          }
        />
      </ToolTaskPage>
      {selectedTask && (
        <div className="result-backdrop" onMouseDown={() => setSelectedTask(null)}>
          <section className="result-drawer" onMouseDown={(e) => e.stopPropagation()}>
            <header>
              <h2 className="text-ink">
                {(selectedTask.result as ApiJobResult | undefined)?.kind === "video-merge"
                  ? "合并视频"
                  : config.result.label}
              </h2>
              <button onClick={() => setSelectedTask(null)} aria-label="关闭">
                <X />
              </button>
            </header>
            <ResultPreview
              task={selectedTask}
              config={config}
              selectedArtifactIds={selectedArtifactIds}
              onToggleArtifact={(artifactId) =>
                setSelectedArtifactIds((current) =>
                  current.includes(artifactId)
                    ? current.filter((selectedId) => selectedId !== artifactId)
                    : [...current, artifactId],
                )
              }
            />
            {(apiError || actionNotice) && (
              <div className={`tool-result-feedback ${apiError ? "error" : ""}`}>{apiError || actionNotice}</div>
            )}
            <div className="tool-result-actions">
              {((selectedTask.result as ApiJobResult | undefined)?.kind === "video-merge"
                ? ["下载选中", "加入素材库"]
                : (selectedTask.result as ApiJobResult | undefined)?.kind === "voice-synthesis"
                  ? ["下载音频", "再次生成"]
                  : config.result.actions
              ).map((action, index) => (
                <button
                  key={action}
                  className={index === 0 ? "primary" : ""}
                  disabled={resultActionRunning}
                  onClick={() => void handleResultAction(action)}
                >
                  {action.includes("复制") ? (
                    <Copy />
                  ) : action.includes("下载") || action.includes("导出") ? (
                    <Download />
                  ) : (
                    <Play />
                  )}
                  {action}
                </button>
              ))}
            </div>
            <div className="tool-result-meta">
              <span>
                执行来源
                <b>
                  {selectedTask.provenance.map((stage) => `${stage.capability}:${stage.executionMode}`).join(" · ")}
                </b>
              </span>
              <span>
                任务状态<b>已完成</b>
              </span>
              <span>
                消耗<b>{config.id === "voice-clone" ? "供应商按量计费" : `${config.cost} 创作点`}</b>
              </span>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
