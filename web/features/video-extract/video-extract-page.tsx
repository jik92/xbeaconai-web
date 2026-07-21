import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchAssetFolders, fetchJobs, submitJob } from "@/api/api-client";

export function VideoExtractPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const folders = useQuery({ queryKey: ["asset-folders"], queryFn: fetchAssetFolders });
  const [folderId, setFolderId] = useState("");
  const jobs = useQuery({ queryKey: ["jobs", "video-extract"], queryFn: () => fetchJobs("video-extract") });
  useEffect(() => {
    if (!folderId && folders.data?.length)
      setFolderId(folders.data.find((folder) => folder.isDefault)?.id ?? folders.data[0]!.id);
  }, [folderId, folders.data]);
  useEffect(() => {
    const timer = window.setInterval(() => void jobs.refetch(), 2_000);
    return () => window.clearInterval(timer);
  }, [jobs.refetch]);
  const create = useMutation({
    mutationFn: () => submitJob("video-extract", "视频提取", { url: url.trim(), outputFolderId: folderId }),
    onSuccess: async () => {
      setOpen(false);
      setUrl("");
      await queryClient.invalidateQueries({ queryKey: ["jobs", "video-extract"] });
    },
  });
  return (
    <main className="utility-task-page">
      <header className="utility-page-header">
        <div>
          <span>实用工具</span>
          <h1>视频提取</h1>
          <p>从公开视频地址提取视频，并直接保存到素材库。</p>
        </div>
        <button className="primary-action" type="button" onClick={() => setOpen(true)}>
          <Plus size={16} />
          新建任务
        </button>
      </header>
      <section className="utility-job-list" aria-label="视频提取任务">
        <div className="utility-job-row utility-job-head">
          <span>任务</span>
          <span>状态</span>
          <span>进度</span>
          <span>创建时间</span>
        </div>
        {jobs.data?.map((job) => (
          <div className="utility-job-row" key={job.id}>
            <span>
              <Download size={16} />
              {job.title}
            </span>
            <span>{job.stage}</span>
            <span>{job.progress}%</span>
            <time>{new Date(job.createdAt).toLocaleString()}</time>
          </div>
        ))}
        {!jobs.data?.length && <div className="utility-empty">还没有视频提取任务</div>}
      </section>
      {open && (
        <div className="utility-dialog-backdrop" role="presentation">
          <form
            className="utility-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <header>
              <div>
                <h2>新建视频提取任务</h2>
                <p>支持视频直链及 yt-dlp 可解析的公开分享页</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="关闭">
                <X />
              </button>
            </header>
            <label>
              视频 URL
              <input
                type="url"
                required
                value={url}
                placeholder="https://…"
                onChange={(event) => setUrl(event.target.value)}
              />
            </label>
            <label>
              目标存储文件夹
              <select required value={folderId} onChange={(event) => setFolderId(event.target.value)}>
                {folders.data?.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </label>
            {create.error && <p className="utility-error">{create.error.message}</p>}
            <footer>
              <button type="button" onClick={() => setOpen(false)}>
                取消
              </button>
              <button className="primary-action" disabled={create.isPending} type="submit">
                {create.isPending ? "提交中…" : "开始提取"}
              </button>
            </footer>
          </form>
        </div>
      )}
    </main>
  );
}
