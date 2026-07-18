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
  if (mimeType.startsWith("video/")) return <video controls autoPlay={autoPlay} src={source} />;
  if (mimeType.startsWith("audio/")) return <audio controls autoPlay={autoPlay} src={source} />;
  return <img src={source} alt={alt} />;
}
