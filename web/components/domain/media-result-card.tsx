import { Download, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MediaPreview } from "./media-preview";

export interface MediaResultCardProps {
  url: string;
  mimeType: string;
  name: string;
  authenticated?: boolean;
  className?: string;
  onDownload?: () => void;
}

export function MediaResultCard({
  url,
  mimeType,
  name,
  authenticated = true,
  className,
  onDownload,
}: MediaResultCardProps) {
  const kind = mimeType.startsWith("video/") ? "video" : mimeType.startsWith("audio/") ? "audio" : "image";
  const visualMedia = kind === "image" || kind === "video";
  const [aspectRatio, setAspectRatio] = useState<number>();
  const [volume, setVolume] = useState(1);
  const cardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const video = cardRef.current?.querySelector<HTMLVideoElement>("video");
    if (!video) return;
    video.muted = volume === 0;
    video.volume = volume;
  }, [volume]);

  return (
    <article
      className={cn("relative self-start overflow-hidden rounded-xl border border-line bg-surface", className)}
      data-media-result-kind={kind}
      ref={cardRef}
    >
      <div
        className={cn(
          "flex items-center justify-center overflow-hidden bg-surface-muted type-helper text-muted",
          visualMedia ? "w-full [&_img]:size-full [&_video]:size-full" : "min-h-16 px-3 py-2 [&>div]:w-full",
        )}
        style={visualMedia ? { aspectRatio: aspectRatio ?? (kind === "video" ? 16 / 9 : 1) } : undefined}
      >
        <MediaPreview
          url={url}
          mimeType={mimeType}
          alt={name}
          authenticated={authenticated}
          className={visualMedia ? "size-full object-contain" : "w-full"}
          containerClassName={visualMedia ? "size-full" : "w-full"}
          loadingText="正在载入结果预览…"
          errorText="结果预览不可用"
          onMetadata={(media) => {
            if (media.width && media.height) setAspectRatio(media.width / media.height);
          }}
        />
      </div>
      {onDownload && (
        <Button
          size="icon-sm"
          variant="outline"
          className={cn(
            "absolute bottom-2 z-[3] rounded-full bg-surface/90 shadow-sm backdrop-blur hover:bg-surface",
            kind === "video" ? "right-28" : "right-2",
          )}
          aria-label={`下载${name}`}
          onClick={onDownload}
        >
          <Download />
        </Button>
      )}
      {kind === "video" && (
        <label className="absolute bottom-2 right-2 z-[3] flex h-8 items-center gap-1 rounded-full border border-line bg-surface/90 px-2 shadow-sm backdrop-blur">
          <Volume2 className="size-4 text-ink" aria-hidden="true" />
          <input
            aria-label={`调整${name}音量`}
            className="w-14 accent-ink"
            max="1"
            min="0"
            step="0.05"
            type="range"
            value={volume}
            onChange={(event) => setVolume(Number(event.target.value))}
          />
        </label>
      )}
    </article>
  );
}
