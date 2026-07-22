import { useQuery } from "@tanstack/react-query";
import { fetchProviderFeatures } from "@/api/api-client";
import type { ModuleId } from "@/entities/types";

export const providerFeaturesQueryKey = ["provider-features"] as const;

export function useProviderFeatures(enabled = true) {
  return useQuery({
    queryKey: providerFeaturesQueryKey,
    queryFn: fetchProviderFeatures,
    enabled,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}

export function moduleProviderAvailability(data: ReturnType<typeof useProviderFeatures>["data"], moduleId: ModuleId) {
  return data?.modules[moduleId];
}
