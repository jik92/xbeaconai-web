export interface PublicMediaUrlInput {
  baseUrl?: string;
  storageKey: string;
  mimeType: string;
  fallbackUrl: string;
}

export function publicMediaUrls(input: PublicMediaUrlInput) {
  if (!input.baseUrl)
    return {
      thumbnailUrl: input.fallbackUrl,
      url: input.fallbackUrl,
      originalUrl: input.fallbackUrl,
    };
  const encodedKey = input.storageKey.split("/").map(encodeURIComponent).join("/");
  const originalUrl = `${input.baseUrl.replace(/\/+$/, "")}/${encodedKey}`;
  const isImage = input.mimeType.startsWith("image/");
  return {
    thumbnailUrl: isImage ? `${originalUrl}?x-tos-process=style/thumbnail` : originalUrl,
    url: isImage ? `${originalUrl}?x-tos-process=style/preview` : originalUrl,
    originalUrl,
  };
}
