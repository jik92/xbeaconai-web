import { useEffect, useState } from "react";
import { authenticatedBlobUrl } from "@/api/api-client";

export function AuthenticatedMedia({
  url,
  mimeType,
  alt,
  autoPlay = false,
}: {
  url: string;
  mimeType: string;
  alt: string;
  autoPlay?: boolean;
}) {
  const [source, setSource] = useState<string>();
  const [error, setError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: retryNonce triggers re-fetch on retry click
  useEffect(() => {
    let active = true;
    let current: string | undefined;
    setError(false);
    setSource(undefined);
    void authenticatedBlobUrl(url)
      .then((value) => {
        current = value;
        if (active) setSource(value);
        else URL.revokeObjectURL(value);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
      if (current) URL.revokeObjectURL(current);
    };
  }, [url, retryNonce]);

  if (error)
    return (
      <span className="authenticated-media-error">
        无法载入预览。
        <button type="button" onClick={() => setRetryNonce((n) => n + 1)}>
          重试
        </button>
      </span>
    );
  if (!source) return <span>正在载入结果预览…</span>;
  // biome-ignore lint/a11y/useMediaCaption: video content is user-uploaded media preview with no captions available
  if (mimeType.startsWith("video/")) return <video controls autoPlay={autoPlay} src={source} />;
  // biome-ignore lint/a11y/useMediaCaption: audio content is user-uploaded media preview with no captions available
  if (mimeType.startsWith("audio/")) return <audio controls autoPlay={autoPlay} src={source} />;
  return <img src={source} alt={alt} />;
}
