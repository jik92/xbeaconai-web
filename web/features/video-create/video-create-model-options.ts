import type { VideoCreateShotGenerationOptions } from "@/api/api-client";

export const videoCreateVideoModelOptions = [
  ["doubao-seedance-2-0-mini-260615", "Seedance 2.0 Mini"],
  ["doubao-seedance-2-0-260128", "Seedance 2.0 Standard"],
  ["doubao-seedance-2-0-fast-260128", "Seedance 2.0 Fast"],
] as const satisfies ReadonlyArray<readonly [VideoCreateShotGenerationOptions["videoModel"], string]>;

export function videoCreateVideoModelLabel(model?: string | null) {
  return videoCreateVideoModelOptions.find(([id]) => id === model)?.[1] ?? model ?? "—";
}
