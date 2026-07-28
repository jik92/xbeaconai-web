import { ImageOff } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { AuthenticatedMedia } from "./authenticated-media";

export interface ProductImageProps {
  url?: string;
  originalUrl?: string;
  mimeType?: string;
  alt: string;
  className?: string;
  authenticated?: boolean;
  imageLoading?: "eager" | "lazy";
}

export function ProductImage({
  url,
  originalUrl,
  mimeType = "image/png",
  alt,
  className,
  authenticated = true,
  imageLoading = "lazy",
}: ProductImageProps) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const failed = Boolean(url && failedUrl === url);

  return (
    <span
      className={cn(
        "product-image flex size-full items-center justify-center overflow-hidden bg-surface-muted p-2 text-muted",
        className,
      )}
    >
      {!url || failed ? (
        <span className="flex size-full items-center justify-center" role="img" aria-label={`${alt}图片不可用`}>
          <ImageOff className="size-5" aria-hidden="true" />
        </span>
      ) : (
        <AuthenticatedMedia
          className="block size-full !object-contain"
          url={url}
          originalUrl={originalUrl}
          mimeType={mimeType}
          alt={alt}
          authenticated={authenticated}
          previewable={false}
          imageLoading={imageLoading}
          loadingText="正在载入商品图片…"
          errorText="商品图片不可用"
          onImageError={() => setFailedUrl(url)}
        />
      )}
    </span>
  );
}
