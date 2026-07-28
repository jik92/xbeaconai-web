import { X } from "lucide-react";
import { AuthenticatedMedia } from "@/components/domain/authenticated-media";
import { Button } from "@/components/ui/button";
import type { AiGenerateReference } from "./ai-generate-runtime";

type AiGenerateReferencePreviewProps = {
  references: AiGenerateReference[];
  removable?: boolean;
  onRemove?: (referenceId: string) => void;
};

export function AiGenerateReferencePreview({
  references,
  removable = false,
  onRemove,
}: AiGenerateReferencePreviewProps) {
  if (!references.length) return null;
  return (
    <section aria-label="参考素材" className="flex flex-wrap gap-2">
      {references.map((reference) => {
        return (
          <article
            className="relative flex w-36 overflow-hidden rounded-lg border border-line bg-surface-muted"
            key={reference.id}
          >
            <div className="size-12 shrink-0 overflow-hidden bg-surface [&_img]:size-full [&_img]:object-cover [&_video]:size-full [&_video]:object-cover">
              <AuthenticatedMedia
                url={reference.url ?? `/api/assets/${reference.id}/access`}
                mimeType={reference.mimeType}
                alt={reference.name}
                controls={false}
                previewable
                containerClassName="size-full"
              />
            </div>
            <div className="min-w-0 flex-1 px-2 py-1.5">
              <b className="block truncate type-badge text-ink">@{reference.label}</b>
              <span className="block truncate type-micro text-muted" title={reference.name}>
                {reference.name}
              </span>
            </div>
            {removable && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute right-0.5 top-0.5 size-5 rounded-full bg-ink/70 p-0 text-on-primary hover:bg-ink"
                aria-label={`移除 ${reference.name}`}
                onClick={() => onRemove?.(reference.id)}
              >
                <X className="size-3" />
              </Button>
            )}
          </article>
        );
      })}
    </section>
  );
}
