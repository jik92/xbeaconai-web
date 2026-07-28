import { Download } from "lucide-react";
import { useState } from "react";
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

  return (
    <article
      className={cn("relative self-start overflow-hidden rounded-xl border border-line bg-surface", className)}
      data-media-result-kind={kind}
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
          className="absolute bottom-2 right-2 z-[3] rounded-full bg-surface/90 shadow-sm backdrop-blur hover:bg-surface"
          aria-label={`下载${name}`}
          onClick={onDownload}
        >
          <Download />
        </Button>
      )}
    </article>
  );
}
