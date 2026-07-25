import { AudioLines, Maximize2, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import ReactPlayer from "react-player";
import { authenticatedBlobUrl } from "@/api/api-client";
import { cn } from "@/lib/utils";

export interface MediaMetadata {
  width?: number;
  height?: number;
  durationSec?: number;
}

export interface NativeMediaPreviewProps {
  src: string;
  alt: string;
  autoPlay?: boolean;
  controls?: boolean;
  className?: string;
  onMetadata?: (metadata: MediaMetadata) => void;
  imageLoading?: "eager" | "lazy";
  onImageError?: () => void;
  initialTime?: number;
  onTimeChange?: (currentTime: number) => void;
  onDurationChange?: (duration: number) => void;
  muted?: boolean;
}

export interface MediaPreviewProps extends Omit<NativeMediaPreviewProps, "src"> {
  url: string;
  mimeType: string;
  loadingText?: string;
  errorText?: string;
  authenticated?: boolean;
  previewable?: boolean;
}

export function ImagePreview({ src, alt, className, imageLoading, onMetadata, onImageError }: NativeMediaPreviewProps) {
  return (
    <img
      className={className}
      src={src}
      alt={alt}
      loading={imageLoading}
      onError={onImageError}
      onLoad={(event) =>
        onMetadata?.({
          width: event.currentTarget.naturalWidth,
          height: event.currentTarget.naturalHeight,
        })
      }
    />
  );
}

export function VideoPreview({
  src,
  autoPlay = false,
  controls = true,
  className,
  onMetadata,
  initialTime = 0,
  onTimeChange,
  onDurationChange,
  muted,
}: NativeMediaPreviewProps) {
  const ref = useRef<HTMLVideoElement>(null);

  return (
    <ReactPlayer
      ref={ref}
      className={cn(className, "object-contain")}
      src={src}
      playing={autoPlay}
      controls={controls}
      autoPlay={autoPlay}
      muted={muted ?? !controls}
      playsInline
      preload="metadata"
      width="100%"
      height="100%"
      style={{ objectFit: "contain", backgroundColor: "#000" }}
      onReady={() => {
        if (ref.current && initialTime > 0) ref.current.currentTime = initialTime;
      }}
      onTimeUpdate={(event) => onTimeChange?.(event.currentTarget.currentTime)}
      onDurationChange={(event) => {
        const duration = event.currentTarget.duration;
        if (Number.isFinite(duration)) onDurationChange?.(duration);
      }}
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
}

export function AudioPreview({
  src,
  alt,
  autoPlay = false,
  controls = true,
  className,
  onMetadata,
  initialTime = 0,
  onTimeChange,
  onDurationChange,
  muted,
}: NativeMediaPreviewProps) {
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (autoPlay) void ref.current?.play().catch(() => undefined);
    else ref.current?.pause();
  }, [autoPlay]);

  return (
    <audio
      ref={ref}
      className={className}
      aria-label={alt}
      controls={controls}
      autoPlay={autoPlay}
      muted={muted ?? !controls}
      preload="metadata"
      src={src}
      onLoadedMetadata={(event) => {
        const audio = event.currentTarget;
        if (initialTime > 0) audio.currentTime = initialTime;
        onMetadata?.({ durationSec: Number.isFinite(audio.duration) ? audio.duration : undefined });
      }}
      onTimeUpdate={(event) => onTimeChange?.(event.currentTarget.currentTime)}
      onDurationChange={(event) => {
        const duration = event.currentTarget.duration;
        if (Number.isFinite(duration)) onDurationChange?.(duration);
      }}
    />
  );
}

function useMediaSource(url: string, authenticated: boolean) {
  const [state, setState] = useState<{ source?: string; error: boolean }>(() => ({
    source: authenticated ? undefined : url,
    error: false,
  }));

  useEffect(() => {
    if (!authenticated) {
      setState({ source: url, error: false });
      return;
    }

    let active = true;
    let current: string | undefined;
    setState({ source: undefined, error: false });
    void authenticatedBlobUrl(url)
      .then((value) => {
        current = value;
        if (active) setState({ source: value, error: false });
        else URL.revokeObjectURL(value);
      })
      .catch(() => {
        if (active) setState({ source: undefined, error: true });
      });

    return () => {
      active = false;
      if (current) URL.revokeObjectURL(current);
    };
  }, [authenticated, url]);

  return state;
}

function renderNativeMedia({
  kind,
  src,
  alt,
  autoPlay,
  controls,
  className,
  onMetadata,
  imageLoading,
  onImageError,
  initialTime,
  onTimeChange,
  onDurationChange,
  muted,
}: NativeMediaPreviewProps & { kind: "image" | "video" | "audio" }) {
  const props = {
    src,
    alt,
    autoPlay,
    controls,
    className,
    onMetadata,
    imageLoading,
    onImageError,
    initialTime,
    onTimeChange,
    onDurationChange,
    muted,
  };
  if (kind === "video") return <VideoPreview {...props} />;
  if (kind === "audio") return <AudioPreview {...props} />;
  return <ImagePreview {...props} />;
}

function MediaLightbox({
  kind,
  source,
  alt,
  onClose,
  currentTime = 0,
  onTimeChange,
  onDurationChange,
}: {
  kind: "image" | "video" | "audio";
  source: string;
  alt: string;
  onClose: () => void;
  currentTime?: number;
  onTimeChange?: (currentTime: number) => void;
  onDurationChange?: (duration: number) => void;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={`${alt}全屏预览`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button
        type="button"
        className="absolute right-4 top-4 inline-flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        aria-label="关闭全屏预览"
        onClick={onClose}
      >
        <X className="size-5" aria-hidden="true" />
      </button>
      {renderNativeMedia({
        kind,
        src: source,
        alt,
        autoPlay: kind !== "image",
        controls: true,
        className:
          kind === "audio"
            ? "w-full max-w-xl rounded-xl bg-white p-3"
            : "max-h-[calc(100vh-4rem)] max-w-full object-contain",
        initialTime: currentTime,
        onTimeChange,
        onDurationChange,
      })}
    </div>
  );
}

function formatPlaybackSeconds(value: number) {
  return `${String(Math.max(0, Math.floor(Number.isFinite(value) ? value : 0))).padStart(2, "0")}s`;
}

function InteractiveVideoPreview({
  source,
  alt,
  className,
  onMetadata,
}: {
  source: string;
  alt: string;
  className?: string;
  onMetadata?: (metadata: MediaMetadata) => void;
}) {
  const [hoverPlaying, setHoverPlaying] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const recordDuration = (nextDuration: number) => {
    setDuration(nextDuration);
  };

  return (
    <div className="group/video-preview relative flex h-full w-full max-h-full max-w-full overflow-hidden">
      {!lightboxOpen && (
        <>
          <VideoPreview
            src={source}
            alt={alt}
            autoPlay={hoverPlaying}
            controls={false}
            className={className}
            muted={false}
            initialTime={currentTime}
            onTimeChange={setCurrentTime}
            onDurationChange={recordDuration}
            onMetadata={(metadata) => {
              if (metadata.durationSec !== undefined) setDuration(metadata.durationSec);
              onMetadata?.(metadata);
            }}
          />
          <button
            type="button"
            className="absolute inset-0 z-[1] cursor-default bg-transparent"
            aria-label={`${alt}视频预览`}
            data-playback-state={hoverPlaying ? "playing" : "paused"}
            onMouseEnter={() => setHoverPlaying(true)}
            onMouseLeave={() => setHoverPlaying(false)}
            onDoubleClick={() => {
              setHoverPlaying(false);
              setLightboxOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              setHoverPlaying(false);
              setLightboxOpen(true);
            }}
          />
        </>
      )}
      <span
        className="pointer-events-none absolute right-2 top-2 z-[2] rounded-md bg-black px-2 py-1 text-2xs text-yellow-300"
        role="timer"
        aria-label="播放时间"
      >
        {formatPlaybackSeconds(currentTime)} / {formatPlaybackSeconds(duration)}
      </span>
      {lightboxOpen && (
        <MediaLightbox
          kind="video"
          source={source}
          alt={alt}
          currentTime={currentTime}
          onTimeChange={setCurrentTime}
          onDurationChange={recordDuration}
          onClose={() => {
            setHoverPlaying(false);
            setLightboxOpen(false);
          }}
        />
      )}
    </div>
  );
}

function InteractiveAudioPreview({
  source,
  alt,
  className,
  onMetadata,
}: {
  source: string;
  alt: string;
  className?: string;
  onMetadata?: (metadata: MediaMetadata) => void;
}) {
  const [hoverPlaying, setHoverPlaying] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div
      className={cn(
        "relative flex h-9 min-h-9 w-full min-w-40 items-center gap-2 overflow-hidden rounded-md border border-line bg-surface px-2",
        className,
      )}
    >
      {!lightboxOpen && (
        <>
          <AudioPreview
            src={source}
            alt={alt}
            autoPlay={hoverPlaying}
            controls={false}
            className="sr-only"
            initialTime={currentTime}
            muted={false}
            onTimeChange={setCurrentTime}
            onDurationChange={setDuration}
            onMetadata={(metadata) => {
              if (metadata.durationSec !== undefined) setDuration(metadata.durationSec);
              onMetadata?.(metadata);
            }}
          />
          <button
            type="button"
            className="absolute inset-0 z-[1] cursor-default bg-transparent"
            aria-label={`${alt}音频预览`}
            data-playback-state={hoverPlaying ? "playing" : "paused"}
            onMouseEnter={() => setHoverPlaying(true)}
            onMouseLeave={() => setHoverPlaying(false)}
            onDoubleClick={() => {
              setHoverPlaying(false);
              setLightboxOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              setHoverPlaying(false);
              setLightboxOpen(true);
            }}
          />
        </>
      )}
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-strong text-ink">
        <AudioLines className="size-3.5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 truncate text-2xs text-ink">{alt}</span>
      <span
        className="pointer-events-none relative z-[2] shrink-0 rounded bg-ink/75 px-1.5 py-0.5 text-2xs text-white"
        role="timer"
        aria-label="播放时间"
      >
        {formatPlaybackSeconds(currentTime)} / {formatPlaybackSeconds(duration)}
      </span>
      <span
        className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary"
        style={{ transform: `scaleX(${progress / 100})` }}
        aria-hidden="true"
      />
      {lightboxOpen && (
        <MediaLightbox
          kind="audio"
          source={source}
          alt={alt}
          currentTime={currentTime}
          onTimeChange={setCurrentTime}
          onDurationChange={setDuration}
          onClose={() => {
            setHoverPlaying(false);
            setLightboxOpen(false);
          }}
        />
      )}
    </div>
  );
}

export function MediaPreview({
  url,
  mimeType,
  alt,
  autoPlay = false,
  controls = true,
  loadingText = "正在载入结果预览…",
  errorText = "预览不可用",
  authenticated = true,
  previewable = true,
  className,
  onMetadata,
}: MediaPreviewProps) {
  const { source, error } = useMediaSource(url, authenticated);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const kind = mimeType.startsWith("video/") ? "video" : mimeType.startsWith("audio/") ? "audio" : "image";

  if (error) return <span>{errorText}</span>;
  if (!source) return <span>{loadingText}</span>;

  if (kind === "video" && previewable)
    return <InteractiveVideoPreview source={source} alt={alt} className={className} onMetadata={onMetadata} />;
  if (kind === "audio" && previewable)
    return <InteractiveAudioPreview source={source} alt={alt} className={className} onMetadata={onMetadata} />;

  let content: ReactNode = renderNativeMedia({
    kind,
    src: source,
    alt,
    autoPlay,
    controls,
    className,
    onMetadata,
  });

  if (!previewable) return content;

  content = (
    <div className={cn("group/media-preview relative inline-flex max-h-full max-w-full", kind === "audio" && "w-full")}>
      {content}
      <button
        type="button"
        className={cn(
          "absolute inline-flex text-white opacity-0 transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white group-hover/media-preview:opacity-100",
          kind === "image"
            ? "inset-0 items-start justify-end rounded-[inherit] p-2"
            : "right-2 top-2 size-8 items-center justify-center rounded-full bg-black/55 hover:bg-black/70",
        )}
        aria-label={`全屏预览${alt}`}
        onClick={() => setLightboxOpen(true)}
      >
        <span className="inline-flex size-8 items-center justify-center rounded-full bg-black/55 hover:bg-black/70">
          <Maximize2 className="size-4" aria-hidden="true" />
        </span>
      </button>
      {lightboxOpen && <MediaLightbox kind={kind} source={source} alt={alt} onClose={() => setLightboxOpen(false)} />}
    </div>
  );

  return content;
}
