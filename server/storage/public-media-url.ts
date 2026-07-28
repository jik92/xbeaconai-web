export interface PublicMediaUrlInput {
  baseUrl?: string;
  storageKey: string;
  mimeType: string;
  fallbackUrl: string;
}

export function publicMediaUrls(input: PublicMediaUrlInput) {
  if (!input.baseUrl)
    return {
      url: input.fallbackUrl,
      originalUrl: input.fallbackUrl,
    };
  const encodedKey = input.storageKey.split("/").map(encodeURIComponent).join("/");
  const originalUrl = `${input.baseUrl.replace(/\/+$/, "")}/${encodedKey}`;
  return {
    url: input.mimeType.startsWith("image/") ? `${originalUrl}?x-tos-process=style/preview` : originalUrl,
    originalUrl,
  };
}
