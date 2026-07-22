import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { Download, Film, FolderOpen, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { downloadAuthenticated, fetchAssetFolders, fetchJobs, submitJob } from "@/api/api-client";
import { AttachmentPicker, type AttachmentSelection } from "@/components/domain/attachment-picker";
import { AuthenticatedMedia } from "@/components/domain/authenticated-media";
import type { TaskSearchFilterValue } from "@/components/domain/task-search-filters";
import { ToolCreatorModal } from "@/components/domain/tool-creator-modal";
import { createToolTaskLabel, ToolTaskPage } from "@/components/domain/tool-task-page";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { Job } from "@/api/generated/types.gen";
import type { ApiJobResult } from "@/entities/types";
import { randomUuid } from "@/lib/random-id";
import {
  theoreticalCombinationCount,
  type VideoMashupConfig,
  validateVideoMashupConfig,
} from "../../../shared/video-mashup/config";

interface EditorGroup {
  id: string;
  name: string;
  assets: AttachmentSelection[];
}

const newGroup = (index: number): EditorGroup => ({ id: randomUuid(), name: `视频组-${index}`, assets: [] });
const activeStatuses = new Set(["queued", "processing"]);
const jobColumn = createColumnHelper<Job>();
const emptyFilters: TaskSearchFilterValue = { name: "", status: "", from: "", to: "" };

export function VideoMashupPage() {
  const newTaskLabel = createToolTaskLabel("视频混剪");
  const queryClient = useQueryClient();
  const { data: folders = [] } = useQuery({ queryKey: ["asset-folders"], queryFn: fetchAssetFolders });
  const { data: jobs = [], refetch } = useQuery({
    queryKey: ["jobs", "video-mashup"],
    queryFn: () => fetchJobs("video-mashup"),
  });
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [groups, setGroups] = useState<EditorGroup[]>([newGroup(1), newGroup(2)]);
  const [taskName, setTaskName] = useState("");
  const [combinationMode, setCombinationMode] = useState<VideoMashupConfig["combinationMode"]>("max-results");
  const [resolution, setResolution] = useState<VideoMashupConfig["resolution"]>("720P");
  const [count, setCount] = useState(1);
  const [outputFolderId, setOutputFolderId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [selectedJobId, setSelectedJobId] = useState("");
  const [resultOpen, setResultOpen] = useState(false);
  const [filters, setFilters] = useState(emptyFilters);
  useEffect(() => {
    if (!outputFolderId && folders.length)
      setOutputFolderId(folders.find((folder) => folder.isDefault)?.id ?? folders[0]?.id ?? "");
  }, [folders, outputFolderId]);
  useEffect(() => {
    if (!jobs.some((job) => activeStatuses.has(job.status))) return;
    const timer = window.setInterval(() => void refetch(), 2_000);
    return () => window.clearInterval(timer);
  }, [jobs, refetch]);
  const theoretical = useMemo(
    () =>
      groups.every((group) => group.assets.length)
        ? theoreticalCombinationCount(groups.map((group) => ({ assetIds: group.assets.map((asset) => asset.id) })))
        : 0,
    [groups],
  );
  const expected = Math.min(count, theoretical, 20);
  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? jobs[0];
  const openCreator = () => {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    setTaskName(
      `混剪_${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}_${pad(now.getHours())}:${pad(now.getMinutes())}`,
    );
    setError("");
    setCreatorOpen(true);
  };
  const addAssets = (groupId: string, assets: AttachmentSelection[]) => {
    setGroups((current) =>
      current.map((group) => {
        if (group.id !== groupId) return group;
        const merged = [...group.assets];
        for (const asset of assets)
          if (!merged.some((item) => item.id === asset.id) && merged.length < 20) merged.push(asset);
        return { ...group, assets: merged };
      }),
    );
  };
  const submit = async () => {
    const config: VideoMashupConfig = {
      version: 1,
      groups: groups.map((group) => ({
        id: group.id,
        name: group.name.trim() || "未命名视频组",
        assetIds: group.assets.map((asset) => asset.id),
      })),
      combinationMode,
      resolution,
      count,
      outputFolderId,
    };
    const invalid = validateVideoMashupConfig(config);
    if (invalid) return setError(invalid);
    if (!taskName.trim()) return setError("请输入任务名称");
    setSubmitting(true);
    setError("");
    try {
      const job = await submitJob("video-mashup", taskName.trim(), { config: JSON.stringify(config), outputFolderId });
      await queryClient.invalidateQueries({ queryKey: ["jobs", "video-mashup"] });
      setSelectedJobId(job.id);
      setCreatorOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "混剪任务提交失败");
    } finally {
      setSubmitting(false);
    }
  };
  const result = selectedJob?.result as ApiJobResult | undefined;
  const filteredJobs = jobs.filter(
    (job) =>
      (!filters.name || job.title.toLowerCase().includes(filters.name.toLowerCase())) &&
      (!filters.status || job.status === filters.status) &&
      (!filters.from || new Date(job.createdAt) >= new Date(`${filters.from}T00:00:00`)) &&
      (!filters.to || new Date(job.createdAt) <= new Date(`${filters.to}T23:59:59.999`)),
  );
  const columns = [
    jobColumn.accessor("title", {
      header: "任务名称",
      size: 300,
      cell: (info) => <span className="truncate font-medium text-ink">{info.getValue()}</span>,
    }),
    jobColumn.accessor("status", {
      header: "状态",
      size: 130,
      cell: (info) => <span>{info.row.original.stage}</span>,
    }),
    jobColumn.accessor("progress", {
      header: "进度",
      size: 170,
      cell: (info) => (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-muted">
            <span className="block h-full rounded-full bg-primary" style={{ width: `${info.getValue()}%` }} />
          </div>
          <span className="text-2xs text-muted">{info.getValue()}%</span>
        </div>
      ),
    }),
    jobColumn.display({
      id: "resultCount",
      header: "结果数",
      size: 90,
      cell: (info) => info.row.original.result?.artifacts.length ?? "—",
    }),
    jobColumn.accessor("createdAt", {
      header: "创建时间",
      size: 190,
      cell: (info) => new Date(info.getValue()).toLocaleString(),
    }),
    jobColumn.display({
      id: "actions",
      header: "操作",
      size: 120,
      cell: (info) => (
        <Button
          className="h-7 px-2 text-2xs text-primary"
          size="sm"
          variant="ghost"
          onClick={() => {
            setSelectedJobId(info.row.original.id);
            setResultOpen(true);
          }}
        >
          查看结果
        </Button>
      ),
    }),
  ] as ColumnDef<Job, unknown>[];
  return (
    <>
      <ToolTaskPage
        actionLabel={newTaskLabel}
        onAction={openCreator}
        onSearch={setFilters}
        count={filteredJobs.length}
        totalCount={jobs.length}
      >
        <DataTable
          className="min-h-0 flex-1"
          columns={columns}
          data={filteredJobs}
          getRowId={(job) => job.id}
          emptyMessage={jobs.length ? "没有符合条件的任务" : "暂无任务"}
          emptyAction={!jobs.length ? <Button onClick={openCreator}>{newTaskLabel}</Button> : undefined}
          height="100%"
        />
      </ToolTaskPage>
      <ToolCreatorModal open={creatorOpen} title={newTaskLabel} onClose={() => setCreatorOpen(false)}>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 text-sm">
          {groups.map((group, groupIndex) => (
            <section className="border-b border-line pb-3" key={group.id}>
              <div className="flex items-center gap-2">
                <Input
                  aria-label={`视频组 ${groupIndex + 1} 名称`}
                  value={group.name}
                  onChange={(event) =>
                    setGroups((current) =>
                      current.map((item) => (item.id === group.id ? { ...item, name: event.target.value } : item)),
                    )
                  }
                />
                {groups.length > 2 && (
                  <Button
                    className="size-8"
                    size="icon"
                    variant="ghost"
                    aria-label={`删除${group.name}`}
                    onClick={() => setGroups((current) => current.filter((item) => item.id !== group.id))}
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {group.assets.map((asset) => (
                  <div className="flex h-8 max-w-40 items-center gap-1 rounded-md bg-surface-muted px-2" key={asset.id}>
                    <Film className="size-3.5 shrink-0" />
                    <span className="truncate text-xs" title={asset.name}>
                      {asset.name}
                    </span>
                    <button
                      type="button"
                      className="shrink-0 text-muted"
                      aria-label={`移除${asset.name}`}
                      onClick={() =>
                        setGroups((current) =>
                          current.map((item) =>
                            item.id === group.id
                              ? { ...item, assets: item.assets.filter((selected) => selected.id !== asset.id) }
                              : item,
                          ),
                        )
                      }
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
                <AttachmentPicker
                  accept="video/*"
                  multiple
                  onSelect={(assets) => addAssets(group.id, assets)}
                  trigger={(open) => (
                    <Button size="sm" variant="outline" onClick={open}>
                      <Plus />
                      选择素材 {group.assets.length}/20
                    </Button>
                  )}
                />
              </div>
            </section>
          ))}
          <Button
            className="self-start"
            size="sm"
            variant="outline"
            disabled={groups.length >= 10}
            onClick={() => setGroups((current) => [...current, newGroup(current.length + 1)])}
          >
            <Plus />
            添加视频组
          </Button>
          <Label className="flex-col items-start text-xs text-muted">
            任务名称
            <Input value={taskName} onChange={(event) => setTaskName(event.target.value)} />
          </Label>
          <Label className="flex-col items-start text-xs text-muted">
            组合模式
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={combinationMode === "max-results" ? "default" : "outline"}
                onClick={() => setCombinationMode("max-results")}
              >
                最多结果数
              </Button>
              <Button
                size="sm"
                variant={combinationMode === "max-difference" ? "default" : "outline"}
                onClick={() => setCombinationMode("max-difference")}
              >
                最大差异化
              </Button>
            </div>
          </Label>
          <Label className="flex-col items-start text-xs text-muted">
            分辨率
            <div className="flex gap-1">
              {(["720P", "1080P"] as const).map((value) => (
                <Button
                  key={value}
                  size="sm"
                  variant={resolution === value ? "default" : "outline"}
                  onClick={() => setResolution(value)}
                >
                  {value}
                </Button>
              ))}
            </div>
          </Label>
          <Label className="flex-col items-start text-xs text-muted">
            最多生成数量
            <Input
              className="w-24"
              type="number"
              min="1"
              max={Math.min(20, Math.max(1, theoretical))}
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
            />
          </Label>
          <Label className="flex-col items-start text-xs text-muted">
            保存位置
            <NativeSelect value={outputFolderId} onChange={(event) => setOutputFolderId(event.target.value)}>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                  {folder.isDefault ? "（默认）" : ""}
                </option>
              ))}
            </NativeSelect>
          </Label>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <span>视频组 {groups.length}</span>
            <span>可用素材 {groups.reduce((sum, group) => sum + group.assets.length, 0)}</span>
            <span>理论组合 {theoretical.toLocaleString()}</span>
            <span>预计生成 {expected}</span>
          </div>
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
        </div>
        <footer className="flex h-13 flex-none items-center justify-end gap-2 border-t border-line px-4">
          <Button size="sm" variant="outline" onClick={() => setCreatorOpen(false)}>
            取消
          </Button>
          <Button size="sm" disabled={submitting} onClick={() => void submit()}>
            {submitting ? "正在提交…" : `创建 ${expected || 0} 个混剪成片`}
          </Button>
        </footer>
      </ToolCreatorModal>
      <ToolCreatorModal open={resultOpen && Boolean(selectedJob)} title="任务结果" onClose={() => setResultOpen(false)}>
        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-4 sm:grid-cols-2">
          {result?.artifacts.map((artifact) => (
            <article className="min-w-0" key={artifact.id}>
              <div className="grid h-32 place-items-center overflow-hidden rounded-md bg-black text-white">
                {artifact.url ? (
                  <AuthenticatedMedia url={artifact.url} mimeType={artifact.mimeType} alt={artifact.name} />
                ) : (
                  <Film />
                )}
              </div>
              <p className="mt-1 truncate text-xs text-ink" title={artifact.name}>
                {artifact.name}
              </p>
              <div className="mt-1 flex gap-1">
                {artifact.url && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => artifact.url && void downloadAuthenticated(artifact.url, artifact.name)}
                  >
                    <Download />
                    下载
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => window.location.assign("/assets/materials")}>
                  <FolderOpen />
                  素材库
                </Button>
              </div>
            </article>
          ))}
          {!result?.artifacts.length && <p className="text-xs text-muted">任务结果尚未生成</p>}
        </div>
      </ToolCreatorModal>
    </>
  );
}
