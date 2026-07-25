import { Check, History, LoaderCircle } from "lucide-react";
import type { VideoCreateMaterialVersion } from "@/api/api-client";
import { AuthenticatedMedia } from "@/components/domain/authenticated-media";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
      <DialogContent className="max-h-[80vh] max-w-4xl overflow-hidden">
        <DialogHeader>
          <DialogTitle className="text-xl">生成历史</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto">
          {props.loading ? (
            <div className="flex h-48 items-center justify-center text-muted">
              <LoaderCircle className="animate-spin" />
            </div>
          ) : props.versions.length ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {props.versions.map((version) => {
                const current = version.id === props.currentVersionId;
                const available = version.available && Boolean(versionUrl(version));
                return (
                  <article className="overflow-hidden rounded-xl border border-line bg-surface" key={version.id}>
                    <div className="flex aspect-video items-center justify-center bg-surface-muted">
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
                    <div className="space-y-2 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-ink">{sourceLabels[version.source]}</span>
                        <span className="text-xs text-muted">{new Date(version.createdAt).toLocaleString()}</span>
                      </div>
                      {version.error?.message && <p className="text-xs text-error">{version.error.message}</p>}
                      <Button
                        className="w-full"
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
                          ? "使用中"
                          : version.status === "pending"
                            ? "生成中"
                            : version.status === "failed"
                              ? "生成失败"
                              : !version.available
                                ? "文件不可用"
                                : "应用此版本"}
                      </Button>
                    </div>
                  </article>
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
