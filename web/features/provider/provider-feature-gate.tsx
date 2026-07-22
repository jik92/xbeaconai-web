import { Ban, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { ModuleId } from "@/entities/types";
import { moduleProviderAvailability, useProviderFeatures } from "./provider-features";

export function ProviderFeatureGate({ moduleId, children }: { moduleId: ModuleId; children: ReactNode }) {
  const query = useProviderFeatures();
  if (query.isLoading)
    return (
      <main className="flex h-[calc(100vh-56px)] items-center justify-center bg-white text-sm text-muted">
        <LoaderCircle className="mr-2 size-4 animate-spin" />
        检查功能状态…
      </main>
    );
  const availability = moduleProviderAvailability(query.data, moduleId);
  if (query.isError || !availability?.enabled)
    return (
      <main className="flex h-[calc(100vh-56px)] items-center justify-center bg-white p-4">
        <div className="flex max-w-lg items-center gap-3 rounded-md border border-line bg-muted/20 px-4 py-3 text-sm text-muted">
          <Ban className="size-4 shrink-0" />
          <span>{availability?.disabledReason ?? "功能状态暂时无法确认，请稍后重试"}</span>
        </div>
      </main>
    );
  return children;
}
