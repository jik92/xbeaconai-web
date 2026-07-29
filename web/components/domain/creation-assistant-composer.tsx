import { ComposerPrimitive, ThreadPrimitive } from "@assistant-ui/react";
import { ArrowDown, Library, Send, Sparkles, X } from "lucide-react";
import type React from "react";
import {
  AttachmentPicker,
  type AttachmentPickerConstraints,
  type AttachmentSelection,
} from "@/components/domain/attachment-picker";
import { AuthenticatedMedia } from "@/components/domain/authenticated-media";
import { Button } from "@/components/ui/button";

export interface CreationAssistantReference {
  id: string;
  name: string;
  mimeType: string;
  label: string;
  url?: string;
}

type CreationAssistantAttachment = {
  accept: string;
  multiple?: boolean;
  showMediaTypeFilters?: boolean;
  constraints?: AttachmentPickerConstraints;
  disabled?: boolean;
  disabledReason?: string;
  onSelect: (assets: AttachmentSelection[]) => void;
};

export function CreationAssistantReferencePreview({
  references,
  removable = false,
  onRemove,
}: {
  references: CreationAssistantReference[];
  removable?: boolean;
  onRemove?: (referenceId: string) => void;
}) {
  if (!references.length) return null;
  return (
    <section aria-label="参考素材" className="flex flex-wrap gap-2">
      {references.map((reference) => (
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
      ))}
    </section>
  );
}

export function CreationAssistantComposer({
  references,
  placeholder,
  header,
  input,
  controls,
  attachment,
  sendLabel,
  sendAriaLabel,
  sendDisabled,
  sendTitle,
  onRemoveReference,
}: {
  references: CreationAssistantReference[];
  placeholder: string;
  header?: React.ReactNode;
  input?: React.ReactNode;
  controls: React.ReactNode;
  attachment?: CreationAssistantAttachment;
  sendLabel: string;
  sendAriaLabel: string;
  sendDisabled: boolean;
  sendTitle?: string;
  onRemoveReference: (referenceId: string) => void;
}) {
  return (
    <ComposerPrimitive.Root
      className="rounded-2xl border border-line bg-surface p-3 shadow-sm"
      data-creation-assistant-composer="true"
    >
      {header}
      <div className="mb-2">
        <CreationAssistantReferencePreview references={references} removable onRemove={onRemoveReference} />
      </div>
      {input ?? (
        <ComposerPrimitive.Input
          rows={2}
          placeholder={placeholder}
          className="max-h-40 min-h-16 w-full resize-none bg-transparent px-1 py-2 type-body text-ink outline-none placeholder:text-muted"
        />
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        {controls}
        {attachment && (
          <AttachmentPicker
            accept={attachment.accept}
            constraints={attachment.constraints}
            multiple={attachment.multiple}
            showMediaTypeFilters={attachment.showMediaTypeFilters}
            onSelect={attachment.onSelect}
            trigger={(open) => (
              <Button
                size="sm"
                variant="outline"
                disabled={attachment.disabled}
                title={attachment.disabledReason}
                onClick={open}
              >
                <Library /> 添加参考素材
              </Button>
            )}
          />
        )}
        <ComposerPrimitive.Send asChild>
          <Button className="ml-auto rounded-full" aria-label={sendAriaLabel} disabled={sendDisabled} title={sendTitle}>
            <Send />
            {sendLabel}
          </Button>
        </ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  );
}

export function CreationAssistantThread({
  title,
  composer,
  messageComponents,
}: {
  title: string;
  composer: React.ReactNode;
  messageComponents?: React.ComponentProps<typeof ThreadPrimitive.Messages>["components"];
}) {
  return (
    <ThreadPrimitive.Root
      className="relative flex min-h-0 flex-1 flex-col bg-surface"
      data-creation-assistant-thread="true"
    >
      <ThreadPrimitive.Viewport className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <ThreadPrimitive.Empty>
          <div className="m-auto flex max-w-md flex-col items-center px-6 text-center">
            <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-surface-muted">
              <Sparkles className="size-5 text-ink" />
            </div>
            <h1 className="type-page-title text-ink">{title}</h1>
          </div>
        </ThreadPrimitive.Empty>
        {messageComponents && <ThreadPrimitive.Messages components={messageComponents} />}
        <ThreadPrimitive.ViewportFooter className="sticky bottom-0 mx-auto w-full max-w-4xl shrink-0 bg-surface/95 px-4 pb-4 pt-2 backdrop-blur">
          <ThreadPrimitive.ScrollToBottom asChild>
            <Button
              variant="outline"
              size="icon-sm"
              className="absolute -top-10 left-1/2 -translate-x-1/2 rounded-full"
              aria-label="滚动到底部"
            >
              <ArrowDown />
            </Button>
          </ThreadPrimitive.ScrollToBottom>
          {composer}
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}
