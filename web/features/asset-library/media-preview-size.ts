export interface MediaPreviewSize {
  width: number;
  height: number;
}

export function fitMediaPreviewSize(
  width?: number,
  height?: number,
  maxWidth = 128,
  maxHeight = 72,
): MediaPreviewSize | undefined {
  if (!width || !height || width <= 0 || height <= 0 || maxWidth <= 0 || maxHeight <= 0) return undefined;

  const scale = Math.min(maxWidth / width, maxHeight / height);
  return {
    width: Math.round(width * scale * 100) / 100,
    height: Math.round(height * scale * 100) / 100,
  };
}
