import { Player, type PlayerRef } from "@remotion/player";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download, Merge, Plus, Scissors, Trash2, X } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { authenticatedBlobUrl, fetchAssetFolders, submitJob, uploadMediaFile } from "@/api/api-client";
import { randomUuid } from "@/lib/random-id";
import {
  clipDuration,
  normalizeVideoEditorTimeline,
  removeVideoEditorSource,
  timelineDuration,
  VIDEO_EDITOR_FPS,
  videoEditorAssetUrl,
  type VideoEditorClip,
  type VideoEditorTimeline,
} from "../../../shared/video-editor/timeline";
import { VideoComposition } from "./video-composition";

const EMPTY_TIMELINE: VideoEditorTimeline = {
  version: 1,
  sources: [],
  clips: [],
  width: 1920,
  height: 1080,
  fps: VIDEO_EDITOR_FPS,
};
const STORAGE_KEY = "yaozuo:video-editor:draft:v1";

async function mediaMetadata(url: string) {
  return new Promise<{ duration: number; width: number; height: number }>((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () =>
      resolve({ duration: video.duration, width: video.videoWidth, height: video.videoHeight });
    video.onerror = () => reject(new Error("无法读取视频信息"));
    video.src = url;
  });
}

export function VideoEditorPage() {
  const player = useRef<PlayerRef>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folders = useQuery({ queryKey: ["asset-folders"], queryFn: fetchAssetFolders });
  const [timeline, setTimeline] = useState<VideoEditorTimeline>(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as VideoEditorTimeline | null;
      return stored ? normalizeVideoEditorTimeline(stored) : EMPTY_TIMELINE;
    } catch {
      return EMPTY_TIMELINE;
    }
  });
  const [history, setHistory] = useState<VideoEditorTimeline[]>([]);
  const [future, setFuture] = useState<VideoEditorTimeline[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [zoom, setZoom] = useState(100);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFolderId, setExportFolderId] = useState("");
  const [outputName, setOutputName] = useState("剪辑成片.mp4");
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!exportFolderId && folders.data?.length)
      setExportFolderId(folders.data.find((folder) => folder.isDefault)?.id ?? folders.data[0]!.id);
  }, [exportFolderId, folders.data]);
  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(timeline));
  }, [timeline]);
  useEffect(() => {
    let active = true;
    const createdUrls: string[] = [];
    setPreviewUrls({});
    void Promise.allSettled(
      timeline.sources.map(async (source) => {
        const url = await authenticatedBlobUrl(videoEditorAssetUrl(source.assetId));
        if (active) createdUrls.push(url);
        else URL.revokeObjectURL(url);
        return [source.id, url] as const;
      }),
    ).then((results) => {
      if (!active) return;
      const entries = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
      setPreviewUrls(Object.fromEntries(entries));
      if (entries.length !== results.length) setMessage("部分视频素材读取失败，可移除失效素材后继续剪辑");
    });
    return () => {
      active = false;
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [timeline.sources]);
  const update = (next: VideoEditorTimeline) => {
    setHistory((items) => [...items.slice(-49), timeline]);
    setFuture([]);
    setTimeline(next);
  };
  const durationInFrames = Math.max(1, Math.ceil(timelineDuration(timeline) * timeline.fps));
  const previewTimeline = useMemo(
    () => ({
      ...timeline,
      sources: timeline.sources.map((source) => ({ ...source, url: previewUrls[source.id] ?? "" })),
    }),
    [previewUrls, timeline],
  );
  const selectedClip = timeline.clips.find((clip) => clip.id === selected[0]);
  const cut = () => {
    const frame = player.current?.getCurrentFrame() ?? 0;
    let cursor = 0;
    const index = timeline.clips.findIndex((clip) => {
      const end = cursor + Math.round(clipDuration(clip) * timeline.fps);
      const contains = frame > cursor && frame < end;
      cursor = end;
      return contains;
    });
    if (index < 0) return setMessage("请把播放头放在片段内部");
    const clip = timeline.clips[index]!;
    const splitSec = clip.inSec + (frame - (cursor - Math.round(clipDuration(clip) * timeline.fps))) / timeline.fps;
    const left = { ...clip, id: randomUuid(), outSec: splitSec, name: `${clip.name} A` };
    const right = { ...clip, id: randomUuid(), inSec: splitSec, name: `${clip.name} B` };
    update({
      ...timeline,
      clips: [...timeline.clips.slice(0, index), left, right, ...timeline.clips.slice(index + 1)],
    });
    setSelected([right.id]);
    setMessage("");
  };
  const merge = () => {
    const indexes = selected.map((id) => timeline.clips.findIndex((clip) => clip.id === id)).sort((a, b) => a - b);
    if (indexes.length < 2 || indexes.some((value, index) => index > 0 && value !== indexes[index - 1]! + 1))
      return setMessage("请选择至少两个相邻片段");
    const clips = indexes.map((index) => timeline.clips[index]!);
    const sameSource =
      clips.every((clip) => clip.sourceId === clips[0]!.sourceId) &&
      clips.every((clip, index) => index === 0 || Math.abs(clip.inSec - clips[index - 1]!.outSec) < 0.02);
    if (!sameSource) return setMessage("只有同一源视频中连续的相邻片段可以合并");
    const merged = {
      ...clips[0]!,
      id: randomUuid(),
      name: clips[0]!.name.replace(/ [AB]$/, ""),
      outSec: clips.at(-1)!.outSec,
    };
    update({
      ...timeline,
      clips: [...timeline.clips.slice(0, indexes[0]), merged, ...timeline.clips.slice(indexes.at(-1)! + 1)],
    });
    setSelected([merged.id]);
    setMessage("");
  };
  const remove = () => {
    if (selected.length) {
      update({ ...timeline, clips: timeline.clips.filter((clip) => !selected.includes(clip.id)) });
      setSelected([]);
    }
  };
  const removeSource = (sourceId: string, sourceName: string) => {
    const removed = removeVideoEditorSource(timeline, sourceId);
    const relatedClipIds = removed.removedClipIds;
    if (
      relatedClipIds.length &&
      !window.confirm(`移除“${sourceName}”将同时删除时间轴中的 ${relatedClipIds.length} 个相关片段，是否继续？`)
    )
      return;
    update(removed.timeline);
    setSelected((items) => items.filter((id) => !relatedClipIds.includes(id)));
    setMessage(relatedClipIds.length ? "素材及相关片段已移除，可撤销" : "素材已移除，可撤销");
  };
  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy("正在上传视频…");
    try {
      let next = timeline;
      for (const file of Array.from(files)) {
        const objectUrl = URL.createObjectURL(file);
        const metadata = await mediaMetadata(objectUrl).finally(() => URL.revokeObjectURL(objectUrl));
        const asset = await uploadMediaFile(file);
        const sourceId = randomUuid();
        next = {
          ...next,
          width: next.sources.length ? next.width : metadata.width,
          height: next.sources.length ? next.height : metadata.height,
          sources: [
            ...next.sources,
            {
              id: sourceId,
              assetId: asset.id,
              name: file.name,
              url: videoEditorAssetUrl(asset.id),
              durationSec: metadata.duration,
              width: metadata.width,
              height: metadata.height,
            },
          ],
          clips: [...next.clips, { id: randomUuid(), sourceId, name: file.name, inSec: 0, outSec: metadata.duration }],
        };
      }
      update(next);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "视频添加失败");
    } finally {
      setBusy("");
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const exportVideo = async () => {
    const folderId = exportFolderId;
    if (!folderId || !timeline.clips.length) return setMessage(folderId ? "时间线不能为空" : "请先创建素材文件夹");
    setBusy("正在提交导出…");
    try {
      const portable = { ...timeline, sources: timeline.sources.map((source) => ({ ...source, url: "" })) };
      await submitJob("video-editor", "视频剪辑导出", {
        timeline: JSON.stringify(portable),
        outputFolderId: folderId,
        outputName: outputName.endsWith(".mp4") ? outputName : `${outputName}.mp4`,
      });
      setMessage("导出任务已提交，可关闭页面等待后台完成");
      setExportOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导出提交失败");
    } finally {
      setBusy("");
    }
  };
  const totalWidth = useMemo(() => Math.max(800, timelineDuration(timeline) * zoom), [timeline, zoom]);
  return (
    <main className="video-editor-page">
      <header className="video-editor-topbar">
        <strong>
          <Scissors size={16} />
          视频剪辑
        </strong>
        <div>
          <input
            ref={fileInput}
            hidden
            type="file"
            accept="video/*"
            multiple
            onChange={(event) => void addFiles(event.target.files)}
          />
          <button type="button" onClick={() => fileInput.current?.click()}>
            <Plus size={16} />
            添加
          </button>
          <button
            className="primary-action"
            type="button"
            onClick={() => setExportOpen(true)}
            disabled={Boolean(busy) || !timeline.clips.length}
          >
            <Download size={16} />
            导出
          </button>
        </div>
      </header>
      <section className="video-editor-workspace">
        <aside className="video-editor-sources">
          <h2>视频素材</h2>
          {timeline.sources.map((source) => (
            <div className="video-editor-source-item" key={source.id}>
              {previewUrls[source.id] ? <video src={previewUrls[source.id]} muted /> : <span>载入中</span>}
              <span>{source.name}</span>
              <button
                type="button"
                aria-label={`移除素材 ${source.name}`}
                title="从当前剪辑中移除"
                onClick={() => removeSource(source.id, source.name)}
              >
                <X size={14} />
              </button>
            </div>
          ))}
          {!timeline.sources.length && <p>点击“添加”上传视频</p>}
        </aside>
        <div className="video-editor-preview">
          {timeline.clips.length ? (
            <div
              className="video-editor-player-frame"
              style={{ "--video-aspect": (timeline.width || 1920) / (timeline.height || 1080) } as CSSProperties}
            >
              <Player
                ref={player}
                component={VideoComposition}
                inputProps={{ timeline: previewTimeline }}
                durationInFrames={durationInFrames}
                compositionWidth={timeline.width || 1920}
                compositionHeight={timeline.height || 1080}
                fps={timeline.fps}
                controls
                style={{ width: "100%", height: "100%" }}
              />
            </div>
          ) : (
            <div className="video-editor-black" />
          )}
        </div>
        <aside className="video-editor-inspector">
          {selectedClip ? (
            <>
              <h2>片段属性</h2>
              <label>
                名称
                <input
                  value={selectedClip.name}
                  onChange={(event) =>
                    setTimeline({
                      ...timeline,
                      clips: timeline.clips.map((clip) =>
                        clip.id === selectedClip.id ? { ...clip, name: event.target.value } : clip,
                      ),
                    })
                  }
                />
              </label>
              <label>
                入点（秒）
                <input
                  type="number"
                  min="0"
                  max={selectedClip.outSec - 0.01}
                  step="0.01"
                  value={selectedClip.inSec}
                  onChange={(event) =>
                    setTimeline({
                      ...timeline,
                      clips: timeline.clips.map((clip) =>
                        clip.id === selectedClip.id
                          ? { ...clip, inSec: Math.max(0, Math.min(Number(event.target.value), clip.outSec - 0.01)) }
                          : clip,
                      ),
                    })
                  }
                />
              </label>
              <label>
                出点（秒）
                <input
                  type="number"
                  min={selectedClip.inSec + 0.01}
                  max={timeline.sources.find((source) => source.id === selectedClip.sourceId)?.durationSec}
                  step="0.01"
                  value={selectedClip.outSec}
                  onChange={(event) =>
                    setTimeline({
                      ...timeline,
                      clips: timeline.clips.map((clip) =>
                        clip.id === selectedClip.id
                          ? {
                              ...clip,
                              outSec: Math.max(
                                clip.inSec + 0.01,
                                Math.min(
                                  Number(event.target.value),
                                  timeline.sources.find((source) => source.id === clip.sourceId)?.durationSec ??
                                    clip.outSec,
                                ),
                              ),
                            }
                          : clip,
                      ),
                    })
                  }
                />
              </label>
              <p>时长 {clipDuration(selectedClip).toFixed(2)} 秒</p>
            </>
          ) : (
            <p>选中时间轴片段以调节片段</p>
          )}
        </aside>
      </section>
      <section className="video-editor-timeline">
        <div className="video-editor-toolbar">
          <button
            type="button"
            aria-label="撤销"
            disabled={!history.length}
            onClick={() => {
              const previous = history.at(-1);
              if (previous) {
                setFuture([timeline, ...future]);
                setTimeline(previous);
                setHistory(history.slice(0, -1));
              }
            }}
          >
            <ChevronLeft />
          </button>
          <button
            type="button"
            aria-label="重做"
            disabled={!future.length}
            onClick={() => {
              const next = future[0];
              if (next) {
                setHistory([...history, timeline]);
                setTimeline(next);
                setFuture(future.slice(1));
              }
            }}
          >
            <ChevronRight />
          </button>
          <button className="tool-primary" type="button" onClick={cut}>
            <Scissors />
            切分
          </button>
          <button type="button" onClick={merge} disabled={selected.length < 2}>
            <Merge />
            合并
          </button>
          <button type="button" onClick={remove} disabled={!selected.length}>
            <Trash2 />
            删除
          </button>
          <span>{busy || message}</span>
          <label>
            缩放
            <input
              type="range"
              min="40"
              max="240"
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
            <output>{zoom}%</output>
          </label>
        </div>
        <div className="video-editor-timeline-scroll">
          <div className="video-editor-ruler" style={{ width: totalWidth }}>
            {Array.from({ length: Math.ceil(timelineDuration(timeline) / 2) + 1 }, (_, index) => (
              <span key={index} style={{ left: index * 2 * zoom }}>
                {(index * 2).toFixed(0)}s
              </span>
            ))}
          </div>
          <div className="video-editor-track" style={{ width: totalWidth }}>
            {timeline.clips.map((clip) => {
              const source = timeline.sources.find((item) => item.id === clip.sourceId);
              return (
                <button
                  type="button"
                  key={clip.id}
                  className={selected.includes(clip.id) ? "selected" : ""}
                  style={{ width: Math.max(48, clipDuration(clip) * zoom) }}
                  onClick={(event) =>
                    setSelected(
                      event.metaKey || event.ctrlKey
                        ? selected.includes(clip.id)
                          ? selected.filter((id) => id !== clip.id)
                          : [...selected, clip.id]
                        : [clip.id],
                    )
                  }
                >
                  {source && previewUrls[source.id] && <video src={previewUrls[source.id]} muted />}
                  <span>{clip.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>
      {exportOpen && (
        <div className="utility-dialog-backdrop" role="presentation">
          <form
            className="utility-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              void exportVideo();
            }}
          >
            <header>
              <h2 className="text-ink">导出视频</h2>
              <button type="button" aria-label="关闭" onClick={() => setExportOpen(false)}>
                <X />
              </button>
            </header>
            <label>
              文件名
              <input required value={outputName} onChange={(event) => setOutputName(event.target.value)} />
            </label>
            <label>
              目标存储文件夹
              <select required value={exportFolderId} onChange={(event) => setExportFolderId(event.target.value)}>
                {folders.data?.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </label>
            <footer>
              <button type="button" onClick={() => setExportOpen(false)}>
                取消
              </button>
              <button className="primary-action" type="submit" disabled={Boolean(busy)}>
                {busy || "开始导出"}
              </button>
            </footer>
          </form>
        </div>
      )}
    </main>
  );
}
