import { Check, History, LoaderCircle } from "lucide-react";
import type { VideoCreateMaterialVersion } from "@/api/api-client";
import { AuthenticatedMedia } from "@/components/domain/authenticated-media";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { videoCreateVideoModelLabel } from "./video-create-model-options";

const sourceLabels: Record<VideoCreateMaterialVersion["source"], string> = {
  ai_generated: "AI 生成视频",
  library_replacement: "素材库替换",
  upload_replacement: "本地上传",
  audio_replaced: "配音替换",
  subtitle_composed: "字幕合成",
};

function versionUrl(version: VideoCreateMaterialVersion) {
  if (!version.contentId || !version.storageKind) return "";
  return version.storageKind === "artifact"
    ? `/api/artifacts/${version.contentId}`
    : `/api/assets/${version.contentId}/content`;
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
}

function formatElapsed(seconds?: number | null) {
  if (seconds === undefined || seconds === null) return "—";
  if (seconds < 60) return `${seconds.toFixed(seconds % 1 ? 1 : 0)} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return remaining ? `${minutes} 分 ${remaining} 秒` : `${minutes} 分钟`;
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="text-xs text-muted">{label}</span>
      <p className="truncate text-sm text-ink" title={value}>
        {value}
      </p>
    </div>
  );
}

export function VideoCreateMaterialHistoryDialog(props: {
  open: boolean;
  versions: VideoCreateMaterialVersion[];
  currentVersionId?: string | null;
  loading: boolean;
  applyingVersionId: string;
  onOpenChange: (open: boolean) => void;
  onApply: (versionId: string) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="grid max-h-[80vh] max-w-5xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="text-xl">生成历史</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto pr-1">
          {props.loading ? (
            <div className="flex h-48 items-center justify-center text-muted">
              <LoaderCircle className="animate-spin" />
            </div>
          ) : props.versions.length ? (
            <div className="space-y-3">
              {props.versions.map((version) => {
                const current = version.id === props.currentVersionId;
                const available = version.available && Boolean(versionUrl(version));
                return (
                  <Card className="gap-0 overflow-hidden py-0 lg:flex-row" key={version.id}>
                    <div className="flex aspect-video w-full shrink-0 items-center justify-center bg-surface-muted text-xs text-muted lg:w-52">
                      {available ? (
                        <AuthenticatedMedia
                          url={versionUrl(version)}
                          mimeType="video/mp4"
                          alt={sourceLabels[version.source]}
                        />
                      ) : version.status === "pending" ? (
                        <LoaderCircle className="animate-spin text-muted" />
                      ) : (
                        <History className="text-muted" />
                      )}
                    </div>
                    <CardContent className="grid min-w-0 flex-1 gap-4 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_12rem_auto] lg:items-center">
                      <div className="min-w-0 space-y-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-ink">{sourceLabels[version.source]}</span>
                          <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-muted">
                            {version.status === "pending"
                              ? "生成中"
                              : version.status === "failed"
                                ? "生成失败"
                                : !available
                                  ? "文件不可用"
                                  : current
                                    ? "当前版本"
                                    : "可选择"}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2 xl:grid-cols-3">
                          <Detail label="模型" value={videoCreateVideoModelLabel(version.generation?.model)} />
                          <Detail
                            label="时长"
                            value={version.generation?.durationSec ? `${version.generation.durationSec} 秒` : "—"}
                          />
                          <Detail label="比例" value={version.generation?.ratio ?? "—"} />
                          <Detail label="分辨率" value={version.generation?.resolution ?? "—"} />
                          <Detail
                            label="原声"
                            value={
                              version.generation?.generateAudio === null ||
                              version.generation?.generateAudio === undefined
                                ? "—"
                                : version.generation.generateAudio
                                  ? "保留"
                                  : "关闭"
                            }
                          />
                          <Detail label="字幕" value={version.subtitlesComposed ? "已合成" : "未合成"} />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:col-span-1 lg:grid-cols-1">
                        <Detail
                          label="提交时间"
                          value={formatDate(version.execution?.submittedAt ?? version.createdAt)}
                        />
                        <Detail label="完成时间" value={formatDate(version.execution?.completedAt)} />
                        <Detail label="总耗时" value={formatElapsed(version.execution?.durationSec)} />
                      </div>
                      <div className="flex flex-col items-stretch gap-2 sm:col-span-2 lg:col-span-1 lg:items-end">
                        {version.error?.message && (
                          <p className="max-w-48 text-xs text-error">{version.error.message}</p>
                        )}
                        <Button
                          size="sm"
                          variant={current ? "outline" : "default"}
                          disabled={!available || current || Boolean(props.applyingVersionId)}
                          onClick={() => props.onApply(version.id)}
                        >
                          {props.applyingVersionId === version.id ? (
                            <LoaderCircle className="animate-spin" />
                          ) : current ? (
                            <Check />
                          ) : (
                            <History />
                          )}
                          {current
                            ? "当前使用"
                            : version.status === "pending"
                              ? "生成中"
                              : version.status === "failed"
                                ? "生成失败"
                                : !version.available
                                  ? "文件不可用"
                                  : "选择此版本"}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <p className="py-16 text-center text-sm text-muted">暂无生成历史</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
