import type { LibraryAsset } from "@/entities/types";

export function resolveOptionalRemixVoice(
  selectedVoice: LibraryAsset | null,
  availableVoices: LibraryAsset[],
): LibraryAsset | null {
  if (!selectedVoice) return null;
  return availableVoices.find((voice) => voice.id === selectedVoice.id) ?? null;
}
