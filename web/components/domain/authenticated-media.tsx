import { useEffect, useState } from "react";
import { authenticatedBlobUrl } from "@/api/api-client";

export function AuthenticatedMedia({
  url,
  mimeType,
  alt,
  autoPlay = false,
  controls = true,
  onMetadata,
}: {
  url: string;
  mimeType: string;
  alt: string;
  autoPlay?: boolean;
  controls?: boolean;
  onMetadata?: (metadata: { width?: number; height?: number; durationSec?: number }) => void;
}) {
  const [source, setSource] = useState<string>();
  useEffect(() => {
    let active = true,
      current: string | undefined;
    void authenticatedBlobUrl(url).then((value) => {
      current = value;
      if (active) setSource(value);
      else URL.revokeObjectURL(value);
    });
    return () => {
      active = false;
      if (current) URL.revokeObjectURL(current);
    };
  }, [url]);
  if (!source) return <span>正在载入结果预览…</span>;
  if (mimeType.startsWith("video/"))
    return (
      <video
        controls={controls}
        autoPlay={autoPlay}
        muted={!controls}
        preload="metadata"
        src={source}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          onMetadata?.({
            width: video.videoWidth || undefined,
            height: video.videoHeight || undefined,
            durationSec: Number.isFinite(video.duration) ? video.duration : undefined,
          });
        }}
      />
    );
  if (mimeType.startsWith("audio/"))
    return (
      <audio
        controls={controls}
        autoPlay={autoPlay}
        muted={!controls}
        preload="metadata"
        src={source}
        onLoadedMetadata={(event) => {
          const audio = event.currentTarget;
          onMetadata?.({ durationSec: Number.isFinite(audio.duration) ? audio.duration : undefined });
        }}
      />
    );
  return (
    <img
      src={source}
      alt={alt}
      onLoad={(event) =>
        onMetadata?.({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
      }
    />
  );
}
