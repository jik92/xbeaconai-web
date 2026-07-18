import { useQuery } from "@tanstack/react-query";
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
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
  Search,
  Sparkles,
  UploadCloud,
  WandSparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  downloadAuthenticated,
  fetchJob,
  fetchJobs,
  fetchModels,
  requestCancel,
  requestRetry,
  submitJob,
  watchJob,
} from "@/api/api-client";
import type { Job, ModuleId, SeedanceModelId } from "@/api/generated/types.gen";
import type { FieldSpec, ModuleConfig } from "@/app/routes";
import type { ApiJobResult } from "@/entities/types";
import { db } from "@/lib/db";
import { AttachmentPicker } from "./attachment-picker";
import { AuthenticatedMedia } from "./authenticated-media";

const statusMap: Record<Job["status"], string> = {
  queued: "排队中",
  processing: "生成中",
  succeeded: "已完成",
  partially_succeeded: "部分完成",
  failed: "失败",
  cancelled: "已取消",
};
const emptyJobs: Job[] = [];
const toolboxDisplayName = (config: ModuleConfig) =>
  config.id === "video-cut" ? "AI视频分割" : config.id === "video-mashup" ? "素材混剪" : config.label;
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
        <button type="button" className={`tool-upload-tile ${value ? "has-file" : ""}`} onClick={open}>
          {value ? <Check /> : <Plus />}
          {names.length > 0 && <small>{names.length > 1 ? `已选择 ${names.length} 个素材` : names[0]}</small>}
        </button>
      )}
      onSelect={(assets) => {
        if (multiple)
          onChange(
            `assets:${JSON.stringify(assets.map((asset) => ({ id: asset.id, name: asset.name, mimeType: asset.mimeType })))}`,
          );
        else if (assets[0]) onChange(`asset:${assets[0].id}:${assets[0].name}`);
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
      className={`tool-switch ${value === "true" ? "active" : ""}`}
      onClick={() => onChange(value === "true" ? "" : "true")}
    >
      <i />
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
  onCancel,
  onSubmit,
}: {
  config: ModuleConfig;
  values: Record<string, string>;
  setValue: (id: string, value: string) => void;
  submitted: boolean;
  running: boolean;
  hydrated: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const field = (id: string) => config.fields.find((item) => item.id === id) as FieldSpec;
  const requiredLabel = (text: string, required = false) => (
    <span className="tool-form-label">
      {required && <em>*</em>}
      {text}：
    </span>
  );
  const select = (id: string, placeholder = "请选择") => {
    const item = field(id);
    return (
      <select value={values[id] ?? ""} onChange={(event) => setValue(id, event.target.value)}>
        {!item.defaultValue && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {item.options?.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    );
  };
  const segments = (id: string) => (
    <div className="tool-segments">
      {field(id).options?.map((option) => (
        <button
          type="button"
          key={option}
          className={values[id] === option ? "active" : ""}
          onClick={() => setValue(id, option)}
        >
          {option}
        </button>
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
  const invalid = (id: string) => submitted && field(id).required && !values[id];
  let content: React.ReactNode;

  if (config.id === "video-cut") {
    content = (
      <div className="tool-simple-form video-cut-form">
        <p>分割后排序：按原始播放顺序</p>
        <p>分割后命名：原始文件名 + 切片序号</p>
        <div className={`tool-form-row ${invalid("method") ? "invalid" : ""}`}>
          {requiredLabel("分割策略", true)}
          {select("method", "请选择分割策略")}
        </div>
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
  } else if (config.id === "video-mashup") {
    content = (
      <div className="mashup-form">
        <section className="mashup-left">
          <div className="gold-template">
            <b>黄金模板：</b>
            <button type="button">选择</button>
          </div>
          <div className="video-group-card">
            <div className="video-group-head">
              <b>视频组-1</b>
              {requiredLabel("画面类型", true)}
              {select("pictureType")}
              <span>分镜贴纸：</span>
              <ToolboxSwitch value={values.shotSticker ?? ""} onChange={(value) => setValue("shotSticker", value)} />
            </div>
            <div className={`material-pick ${invalid("assets") ? "invalid" : ""}`}>
              {requiredLabel("选择素材", true)}
              {upload("assets", true)}
            </div>
          </div>
          <button type="button" className="add-video-group">
            <Plus /> 添加视频组
          </button>
        </section>
        <section className="mashup-right">
          <div className={`tool-form-row ${invalid("taskName") ? "invalid" : ""}`}>
            {requiredLabel("任务名称", true)}
            <input value={values.taskName ?? ""} onChange={(event) => setValue("taskName", event.target.value)} />
          </div>
          <div className="tool-form-row">
            {requiredLabel("组合模式")}
            {segments("combinationMode")}
          </div>
          <div className="tool-form-row combo-summary">
            {requiredLabel("混剪组合")}
            <span>
              <b>外观样式</b>
              <small>商品信息</small>
            </span>
          </div>
          <div className="tool-form-row">
            {requiredLabel("分辨率")}
            {segments("resolution")}
          </div>
          <div className="tool-form-row short-input">
            {requiredLabel("最多生成数量")}
            <input
              type="number"
              min="1"
              max="20"
              value={values.count ?? "1"}
              onChange={(event) => setValue("count", event.target.value)}
            />
          </div>
          <div className={`tool-form-row save-location ${invalid("saveLocation") ? "invalid" : ""}`}>
            {requiredLabel("保存位置", true)}
            {select("saveLocation")}
            <button type="button">设为默认</button>
          </div>
          <div className="tool-form-row compact-row">
            {requiredLabel("自动采纳")}
            <ToolboxSwitch value={values.autoAccept ?? ""} onChange={(value) => setValue("autoAccept", value)} />
          </div>
          <div className="tool-form-row compact-row">
            {requiredLabel("全局贴纸")}
            <ToolboxSwitch value={values.globalSticker ?? ""} onChange={(value) => setValue("globalSticker", value)} />
          </div>
        </section>
      </div>
    );
  } else if (config.id === "voice-clone") {
    content = (
      <div className="tool-simple-form voice-clone-form">
        <div className="tool-form-row compact-row">
          {requiredLabel("自动保存")}
          <ToolboxSwitch value={values.autoSave ?? ""} onChange={(value) => setValue("autoSave", value)} />
        </div>
        <div className={`tool-form-row upload-row ${invalid("sample") ? "invalid" : ""}`}>
          {requiredLabel("原始音频", true)}
          {upload("sample")}
        </div>
        <div className={`tool-form-row textarea-row ${invalid("transcript") ? "invalid" : ""}`}>
          {requiredLabel("音频转换文本", true)}
          <div>
            <textarea
              maxLength={1000}
              value={values.transcript ?? ""}
              placeholder="请输入音频转换文本"
              onChange={(event) => setValue("transcript", event.target.value)}
            />
            <small>{(values.transcript ?? "").length} / 1000</small>
          </div>
        </div>
        <div className="tool-form-row speed-row">
          {requiredLabel("音色速度", true)}
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            value={values.speed ?? "1.0"}
            onChange={(event) => setValue("speed", event.target.value)}
          />
          <input
            type="number"
            min="0.5"
            max="2"
            step="0.1"
            value={values.speed ?? "1.0"}
            onChange={(event) => setValue("speed", event.target.value)}
          />
        </div>
        <div className="tool-form-row">
          {requiredLabel("语言选择", true)}
          {select("language")}
        </div>
        <div className="tool-form-row">
          {requiredLabel("配音风格", true)}
          {select("style")}
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
      <div className="subtitle-form">
        <section>
          <div className="subtitle-preview">
            <span>{values.source ? "拖动白色选框，框住需要擦除的字幕区域" : "请先选择视频"}</span>
            {values.source && <i />}
          </div>
          <p>拖拽白色选框，框住需要擦除的字幕区域</p>
        </section>
        <section className="subtitle-settings">
          <div className={`tool-form-row upload-row ${invalid("source") ? "invalid" : ""}`}>
            {requiredLabel("选择视频", true)}
            {upload("source")}
          </div>
          <div className="tool-form-row compact-row">
            {requiredLabel("自动保存")}
            <ToolboxSwitch value={values.autoSave ?? ""} onChange={(value) => setValue("autoSave", value)} />
          </div>
        </section>
      </div>
    );
  } else if (config.id === "video-enhancement") {
    content = (
      <div className="tool-simple-form enhancement-form">
        <div className="tool-form-row">
          {requiredLabel("模式", true)}
          {select("mode")}
        </div>
        <div className="tool-form-row">
          {requiredLabel("使用场景", true)}
          {select("scene")}
        </div>
        <div className="tool-form-row">
          {requiredLabel("帧率", true)}
          {select("fps")}
        </div>
        <div className="tool-form-row">
          {requiredLabel("分辨率", true)}
          {select("resolution")}
        </div>
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
      <div className="tool-creator-content">{content}</div>
      <footer className="tool-creator-footer">
        <button type="button" onClick={onCancel}>
          取消
        </button>
        <button type="button" className="primary" disabled={running || !hydrated} onClick={onSubmit}>
          {running ? <LoaderCircle className="animate-spin" /> : null}
          {running ? "提交中…" : "确定"}
        </button>
      </footer>
    </>
  );
}

function TaskTable({
  tasks,
  retry,
  preview,
  cancel,
}: {
  tasks: Job[];
  retry: (t: Job) => void;
  preview: (t: Job) => void;
  cancel: (t: Job) => void;
}) {
  const column = createColumnHelper<Job>();
  const columns = useMemo(
    () => [
      column.accessor("title", {
        header: "任务名称",
        cell: (i) => (
          <div>
            <b>{i.getValue()}</b>
            <small className="block">
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
        cell: (i) => (
          <span className={`status status-${i.getValue()}`}>
            {i.getValue() === "processing" && <LoaderCircle size={13} className="animate-spin" />}
            {statusMap[i.getValue()]}
          </span>
        ),
      }),
      column.accessor("progress", {
        header: "进度",
        cell: (i) => (
          <div className="progress">
            <span style={{ width: `${i.getValue()}%` }} />
            <em>{i.getValue()}%</em>
          </div>
        ),
      }),
      column.display({
        id: "resultCount",
        header: "结果数",
        cell: (i) => i.row.original.result?.artifacts.length ?? "—",
      }),
      column.display({
        id: "creator",
        header: "创建人",
        cell: () => "当前用户",
      }),
      column.display({
        id: "createdAt",
        header: "创建时间",
        cell: (i) => new Date(i.row.original.createdAt).toLocaleString(),
      }),
      column.display({
        id: "updatedAt",
        header: "更新时间",
        cell: (i) => new Date(i.row.original.updatedAt).toLocaleString(),
      }),
      column.display({
        id: "actions",
        header: "操作",
        cell: (i) => (
          <div className="row-actions">
            {i.row.original.status === "succeeded" || i.row.original.status === "partially_succeeded" ? (
              <>
                <button onClick={() => preview(i.row.original)}>
                  <Play size={14} />
                  查看结果
                </button>
                {i.row.original.status === "partially_succeeded" ? (
                  <button onClick={() => retry(i.row.original)}>
                    <RotateCcw size={14} />
                    重试未完成
                  </button>
                ) : (
                  <button onClick={() => preview(i.row.original)}>
                    <Download size={14} />
                    导出
                  </button>
                )}
              </>
            ) : i.row.original.status === "failed" || i.row.original.status === "cancelled" ? (
              <button onClick={() => retry(i.row.original)}>
                <RotateCcw size={14} />
                重试
              </button>
            ) : (
              <button onClick={() => cancel(i.row.original)}>
                <X size={14} />
                取消
              </button>
            )}
          </div>
        ),
      }),
    ],
    [column, retry, preview, cancel],
  );
  const table = useReactTable({ data: tasks, columns, getCoreRowModel: getCoreRowModel() });
  return (
    <div className="table-wrap">
      <table>
        <thead>
          {table.getHeaderGroups().map((g) => (
            <tr key={g.id}>
              {g.headers.map((h) => (
                <th key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((r) => (
            <tr key={r.id}>
              {r.getVisibleCells().map((c) => (
                <td key={c.id}>{flexRender(c.column.columnDef.cell, c.getContext())}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultPreview({ task, config }: { task: Job; config: ModuleConfig }) {
  const result = task.result as ApiJobResult | undefined;
  const media = result?.artifacts.find((artifact) => /^(video|audio|image)\//.test(artifact.mimeType));
  const text = result?.artifacts.find((artifact) => artifact.text)?.text;
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
  const [apiError, setApiError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [videoModel, setVideoModel] = useState<SeedanceModelId>("doubao-seedance-2-0-fast-260128");
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [taskNameFilter, setTaskNameFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFromFilter, setDateFromFilter] = useState("");
  const [dateToFilter, setDateToFilter] = useState("");
  const [appliedFilters, setAppliedFilters] = useState({ name: "", status: "", from: "", to: "" });
  const setValue = (id: string, value: string) => setValues((old) => ({ ...old, [id]: value }));
  const { data: restored = emptyJobs } = useQuery({
    queryKey: ["api-tasks", config.id],
    queryFn: () => fetchJobs(config.id as ModuleId),
    refetchInterval: 5000,
  });
  const { data: modelCatalog = [] } = useQuery({ queryKey: ["api-models"], queryFn: fetchModels, staleTime: 60_000 });
  useEffect(() => setTasks(restored), [restored]);
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
  const missing = config.fields.filter((field) => field.required && !values[field.id]);
  const missingVisible = visibleFields.filter((field) => field.required && !values[field.id]);
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
      const job = await submitJob(
        config.id as ModuleId,
        values.taskName ||
          `${config.label} · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
        { ...values, __scenario: scenario },
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
    if (action.includes("用于混剪") || action.includes("合并片段")) {
      window.location.href = "/tools/video-mashup";
      return;
    }
    if (action.includes("加入素材库") || action.includes("收藏") || action.includes("设为常用")) {
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
    <div className="module-page tool-task-page">
      {creatorOpen && (
        <div className="creator-backdrop" onMouseDown={() => setCreatorOpen(false)}>
          <section className={`creator-dialog creator-${config.id}`} onMouseDown={(event) => event.stopPropagation()}>
            <header className="creator-head">
              <div>
                <h2>{toolboxDisplayName(config)}</h2>
                {config.id === "subtitle-erase" && (
                  <span>
                    字幕擦除 · 精细擦除 <small>仅擦除框选区域内的字幕</small>
                  </span>
                )}
              </div>
              <button type="button" aria-label="关闭新建窗口" onClick={() => setCreatorOpen(false)}>
                <X />
              </button>
            </header>
            <div className="creator-body">
              <ToolboxCreatorForm
                config={config}
                values={values}
                setValue={setValue}
                submitted={submitted}
                running={running}
                hydrated={hydrated}
                onCancel={() => setCreatorOpen(false)}
                onSubmit={() => void submit()}
              />
              {apiError && <div className="tool-creator-error">{apiError}</div>}
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
          </section>
        </div>
      )}
      <section className="tasks-section">
        <div className="task-page-title">
          <div>
            <span>AI 工具箱</span>
            <h1>{toolboxDisplayName(config)}任务</h1>
            <p>查看任务状态、处理进度和生成结果。</p>
          </div>
        </div>
        <div className="task-filters">
          <label>
            <span>任务名称</span>
            <input
              value={taskNameFilter}
              onChange={(event) => setTaskNameFilter(event.target.value)}
              placeholder="请输入"
            />
          </label>
          <label>
            <span>处理状态</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">不限</option>
              <option value="queued">排队中</option>
              <option value="processing">生成中</option>
              <option value="succeeded">已完成</option>
              <option value="partially_succeeded">部分完成</option>
              <option value="failed">失败</option>
              <option value="cancelled">已取消</option>
            </select>
          </label>
          <label>
            <span>创建人</span>
            <select defaultValue="current">
              <option value="current">当前用户</option>
            </select>
          </label>
          <label className="date-filter">
            <span>创建时间</span>
            <input
              type="date"
              aria-label="开始日期"
              value={dateFromFilter}
              onChange={(event) => setDateFromFilter(event.target.value)}
            />
            <i>至</i>
            <input
              type="date"
              aria-label="结束日期"
              value={dateToFilter}
              onChange={(event) => setDateToFilter(event.target.value)}
            />
          </label>
          <div className="filter-actions">
            <button
              type="button"
              className="reset-filter"
              onClick={() => {
                setTaskNameFilter("");
                setStatusFilter("");
                setDateFromFilter("");
                setDateToFilter("");
                setAppliedFilters({ name: "", status: "", from: "", to: "" });
              }}
            >
              重置
            </button>
            <button
              type="button"
              className="query-filter"
              onClick={() =>
                setAppliedFilters({
                  name: taskNameFilter.trim(),
                  status: statusFilter,
                  from: dateFromFilter,
                  to: dateToFilter,
                })
              }
            >
              <Search />
              查询
            </button>
          </div>
        </div>
        <div className="task-toolbar">
          <button type="button" className="new-task-button" onClick={() => setCreatorOpen(true)}>
            <Plus />
            {toolboxDisplayName(config)}
          </button>
          <small>共 {filteredTasks.length} 个任务</small>
        </div>
        {filteredTasks.length ? (
          <TaskTable tasks={filteredTasks} retry={retry} preview={setSelectedTask} cancel={cancel} />
        ) : (
          <div className="empty">
            <X size={24} />
            <b>{tasks.length ? "没有符合条件的任务" : "暂无数据"}</b>
            <span>
              {tasks.length ? "请调整筛选条件后重新查询" : `点击“${toolboxDisplayName(config)}”创建第一个任务`}
            </span>
          </div>
        )}
      </section>
      {selectedTask && (
        <div className="result-backdrop" onMouseDown={() => setSelectedTask(null)}>
          <section className="result-drawer" onMouseDown={(e) => e.stopPropagation()}>
            <header>
              <div>
                <span>
                  生成结果 ·{" "}
                  {selectedTask.overallExecutionMode === "mixed"
                    ? "混合链路"
                    : selectedTask.overallExecutionMode === "mock"
                      ? "模拟结果"
                      : selectedTask.overallExecutionMode === "local"
                        ? "本地处理"
                        : "真实生成"}
                </span>
                <h2>{config.result.label}</h2>
              </div>
              <button onClick={() => setSelectedTask(null)} aria-label="关闭">
                <X />
              </button>
            </header>
            <ResultPreview task={selectedTask} config={config} />
            <div className="result-actions">
              {config.result.actions.map((action, index) => (
                <button
                  key={action}
                  className={index === 0 ? "primary" : ""}
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
            <div className="result-meta">
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
                消耗<b>{config.cost} 创作点</b>
              </span>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
