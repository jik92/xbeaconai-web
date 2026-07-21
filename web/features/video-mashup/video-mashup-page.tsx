import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Film, FolderOpen, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { downloadAuthenticated, fetchAssetFolders, fetchJobs, submitJob } from "@/api/api-client";
import { AttachmentPicker, type AttachmentSelection } from "@/components/domain/attachment-picker";
import { AuthenticatedMedia } from "@/components/domain/authenticated-media";
import type { ApiJobResult } from "@/entities/types";
import { randomUuid } from "@/lib/random-id";
import {
  theoreticalCombinationCount,
  type VideoMashupConfig,
  validateVideoMashupConfig,
} from "../../../shared/video-mashup/config";
import "./video-mashup.css";

interface EditorGroup {
  id: string;
  name: string;
  assets: AttachmentSelection[];
}

const newGroup = (index: number): EditorGroup => ({ id: randomUuid(), name: `视频组-${index}`, assets: [] });
const activeStatuses = new Set(["queued", "processing"]);

export function VideoMashupPage() {
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
  return (
    <main className="mashup-page">
      <header className="mashup-page-header">
        <div>
          <span>AI 工具箱</span>
          <h1>视频混剪</h1>
          <p>从每个视频组选择一个素材，批量生成差异化成片。</p>
        </div>
        <button type="button" className="primary-action" onClick={openCreator}>
          <Plus />
          新建混剪任务
        </button>
      </header>
      <section className="mashup-dashboard">
        <div className="mashup-task-list">
          <header>
            <h2>混剪任务</h2>
            <small>{jobs.length} 个任务</small>
          </header>
          {jobs.map((job) => (
            <button
              type="button"
              key={job.id}
              className={selectedJob?.id === job.id ? "selected" : ""}
              onClick={() => setSelectedJobId(job.id)}
            >
              <span>
                <Film />
                {job.title}
              </span>
              <small>
                {job.stage} · {job.progress}%
              </small>
            </button>
          ))}
          {!jobs.length && <div className="mashup-empty">还没有混剪任务</div>}
        </div>
        <div className="mashup-result-panel">
          {selectedJob ? (
            <>
              <header>
                <div>
                  <span>{selectedJob.status}</span>
                  <h2>{selectedJob.title}</h2>
                  <p>{result?.summary ?? selectedJob.stage}</p>
                </div>
                <strong>{selectedJob.progress}%</strong>
              </header>
              <div className="mashup-result-grid">
                {result?.artifacts.map((artifact, index) => (
                  <article key={artifact.id}>
                    <div>
                      {artifact.url ? (
                        <AuthenticatedMedia url={artifact.url} mimeType={artifact.mimeType} alt={artifact.name} />
                      ) : (
                        <Film />
                      )}
                    </div>
                    <span>
                      {String(index + 1).padStart(2, "0")} · {artifact.name}
                    </span>
                    <footer>
                      {artifact.url && (
                        <button
                          type="button"
                          onClick={() => artifact.url && void downloadAuthenticated(artifact.url, artifact.name)}
                        >
                          <Download />
                          下载
                        </button>
                      )}
                      <a href="/assets/materials">
                        <FolderOpen />
                        素材库
                      </a>
                    </footer>
                  </article>
                ))}
              </div>
              {!result?.artifacts.length && <div className="mashup-empty">任务结果将在这里显示</div>}
            </>
          ) : (
            <div className="mashup-empty">选择任务查看批次结果</div>
          )}
        </div>
      </section>
      {creatorOpen && (
        <div className="mashup-creator-layer" role="presentation">
          <section className="mashup-creator" role="dialog" aria-modal="true" aria-label="新建混剪任务">
            <header>
              <div>
                <span>VIDEO MASHUP</span>
                <h2>新建混剪任务</h2>
              </div>
              <button type="button" aria-label="关闭" onClick={() => setCreatorOpen(false)}>
                <X />
              </button>
            </header>
            <div className="mashup-creator-body">
              <div className="mashup-group-editor">
                <div className="mashup-section-title">
                  <div>
                    <h3>视频组</h3>
                    <p>每个成片会按顺序从每组选择一个视频。</p>
                  </div>
                  <b>{groups.length}/10 组</b>
                </div>
                {groups.map((group, groupIndex) => (
                  <article className="mashup-group-card" key={group.id}>
                    <header>
                      <input
                        aria-label={`视频组 ${groupIndex + 1} 名称`}
                        value={group.name}
                        onChange={(event) =>
                          setGroups((current) =>
                            current.map((item) =>
                              item.id === group.id ? { ...item, name: event.target.value } : item,
                            ),
                          )
                        }
                      />
                      {groups.length > 2 && (
                        <button
                          type="button"
                          aria-label={`删除${group.name}`}
                          onClick={() => setGroups((current) => current.filter((item) => item.id !== group.id))}
                        >
                          <Trash2 />
                        </button>
                      )}
                    </header>
                    <div className="mashup-selected-assets">
                      {group.assets.map((asset) => (
                        <div key={asset.id}>
                          {asset.url ? (
                            <AuthenticatedMedia
                              url={asset.url}
                              mimeType={asset.mimeType}
                              alt={asset.name}
                              controls={false}
                            />
                          ) : (
                            <Film />
                          )}
                          <span title={asset.name}>{asset.name}</span>
                          <button
                            type="button"
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
                            <X />
                          </button>
                        </div>
                      ))}
                      <AttachmentPicker
                        accept="video/*"
                        multiple
                        onSelect={(assets) => addAssets(group.id, assets)}
                        trigger={(open) => (
                          <button type="button" className="mashup-add-assets" onClick={open}>
                            <Plus />
                            选择素材<small>{group.assets.length}/20</small>
                          </button>
                        )}
                      />
                    </div>
                  </article>
                ))}
                <button
                  type="button"
                  className="mashup-add-group"
                  disabled={groups.length >= 10}
                  onClick={() => setGroups((current) => [...current, newGroup(current.length + 1)])}
                >
                  <Plus />
                  添加视频组
                </button>
              </div>
              <aside className="mashup-settings">
                <h3>输出设置</h3>
                <label>
                  任务名称
                  <input value={taskName} onChange={(event) => setTaskName(event.target.value)} />
                </label>
                <fieldset>
                  <legend>组合模式</legend>
                  <button
                    type="button"
                    className={combinationMode === "max-results" ? "selected" : ""}
                    onClick={() => setCombinationMode("max-results")}
                  >
                    最多结果数
                  </button>
                  <button
                    type="button"
                    className={combinationMode === "max-difference" ? "selected" : ""}
                    onClick={() => setCombinationMode("max-difference")}
                  >
                    最大差异化
                  </button>
                </fieldset>
                <fieldset>
                  <legend>分辨率</legend>
                  <button
                    type="button"
                    className={resolution === "720P" ? "selected" : ""}
                    onClick={() => setResolution("720P")}
                  >
                    720P
                  </button>
                  <button
                    type="button"
                    className={resolution === "1080P" ? "selected" : ""}
                    onClick={() => setResolution("1080P")}
                  >
                    1080P
                  </button>
                </fieldset>
                <label>
                  最多生成数量
                  <input
                    type="number"
                    min="1"
                    max={Math.min(20, Math.max(1, theoretical))}
                    value={count}
                    onChange={(event) => setCount(Number(event.target.value))}
                  />
                </label>
                <label>
                  保存位置
                  <select value={outputFolderId} onChange={(event) => setOutputFolderId(event.target.value)}>
                    {folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                        {folder.isDefault ? "（默认）" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <dl>
                  <div>
                    <dt>视频组</dt>
                    <dd>{groups.length}</dd>
                  </div>
                  <div>
                    <dt>可用素材</dt>
                    <dd>{groups.reduce((sum, group) => sum + group.assets.length, 0)}</dd>
                  </div>
                  <div>
                    <dt>理论组合</dt>
                    <dd>{theoretical.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>预计生成</dt>
                    <dd>{expected}</dd>
                  </div>
                </dl>
                {error && <p className="mashup-error">{error}</p>}
                <button
                  type="button"
                  className="primary-action mashup-submit"
                  disabled={submitting}
                  onClick={() => void submit()}
                >
                  {submitting ? "正在提交…" : `创建 ${expected || 0} 个混剪成片`}
                </button>
              </aside>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
