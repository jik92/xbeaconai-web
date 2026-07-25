import { ArrowUp, Expand, FileAudio, FileImage, FileVideo, Plus, Shrink, Trash2 } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { cn } from "@/lib/utils";
import { AttachmentPicker, type AttachmentSelection } from "./attachment-picker";

export interface PromptReference {
  id: string;
  name: string;
  kind: "image" | "video" | "audio";
}

export function PromptWorkbench({
  expanded,
  docked = false,
  embedded = false,
  lockedReferenceIds = [],
  references,
  prompt,
  placeholder,
  inputLabel,
  inputRef,
  accept = "image/*,video/*,audio/*",
  multiple = true,
  controls,
  children,
  submitting = false,
  onChooseAssets,
  onRemoveReference,
  onPromptChange,
  onExpandedChange,
  onSubmit,
}: {
  expanded: boolean;
  docked?: boolean;
  embedded?: boolean;
  lockedReferenceIds?: readonly string[];
  references: PromptReference[];
  prompt: string;
  placeholder: string;
  inputLabel: string;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  accept?: string;
  multiple?: boolean;
  controls: ReactNode;
  children?: ReactNode;
  submitting?: boolean;
  onChooseAssets: (assets: AttachmentSelection[]) => void;
  onRemoveReference: (id: string) => void;
  onPromptChange: (value: string) => void;
  onExpandedChange: (expanded: boolean) => void;
  onSubmit: () => void;
}) {
  return (
    <section
      className={cn(
        "absolute left-1/2 top-31 z-20 h-51 w-[min(900px,calc(100%-32px))] -translate-x-1/2 rounded-xl border border-line bg-white p-4 shadow-sm transition-[height,top]",
        expanded && "h-107.5",
        docked && "bottom-11 top-auto",
        embedded && "relative inset-auto w-full translate-x-0 shadow-none",
      )}
    >
      <div className="flex h-18 items-start gap-2 overflow-x-auto">
        <AttachmentPicker
          accept={accept}
          multiple={multiple}
          trigger={(open) => (
            <button
              type="button"
              className="flex h-17.5 w-14 shrink-0 -rotate-6 flex-col items-center justify-center gap-0.5 border border-dashed border-line-strong bg-white text-muted"
              aria-label="添加参考素材"
              onClick={open}
            >
              <Plus className="size-4" />
              <span className="text-xs">参考</span>
            </button>
          )}
          onSelect={onChooseAssets}
        />
        {references.map((reference) => (
          <div
            className="flex h-15.5 min-w-42.5 max-w-57.5 items-center gap-2 rounded-md border border-line bg-canvas-soft px-2"
            key={reference.id}
          >
            {reference.kind === "image" ? (
              <FileImage className="size-5 text-primary" />
            ) : reference.kind === "video" ? (
              <FileVideo className="size-5 text-primary" />
            ) : (
              <FileAudio className="size-5 text-primary" />
            )}
            <span className="min-w-0 flex-1">
              <b className="block truncate text-xs font-medium">{reference.name}</b>
              <small className="mt-0.5 block truncate text-2xs text-muted">{reference.kind}</small>
            </span>
            {!lockedReferenceIds.includes(reference.id) && (
              <button
                type="button"
                className="text-muted"
                aria-label={`移除 ${reference.name}`}
                onClick={() => onRemoveReference(reference.id)}
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
      <textarea
        ref={inputRef}
        aria-label={inputLabel}
        placeholder={placeholder}
        value={prompt}
        className={cn(
          "absolute left-20.5 right-9.5 top-4 h-30 w-[calc(100%-126px)] resize-none bg-transparent text-sm leading-relaxed text-ink outline-none placeholder:text-muted-soft",
          expanded && "h-86.5",
        )}
        onChange={(event) => onPromptChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onSubmit();
          }
        }}
      />
      <button
        type="button"
        className="absolute right-2.5 top-3 grid size-6 place-items-center rounded-md border border-line bg-white text-muted"
        aria-label={expanded ? "收起输入框" : "展开输入框"}
        onClick={() => onExpandedChange(!expanded)}
      >
        {expanded ? <Shrink className="size-3.5" /> : <Expand className="size-3.5" />}
      </button>
      <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
        <div className="flex gap-1 [&>button]:flex [&>button]:h-9 [&>button]:items-center [&>button]:gap-1 [&>button]:rounded-md [&>button]:border [&>button]:border-line [&>button]:bg-white [&>button]:px-3 [&>button]:text-xs [&>button]:text-ink [&_svg]:size-3.5">
          {controls}
        </div>
        <button
          type="button"
          className="grid size-8.5 place-items-center rounded-full bg-primary text-white disabled:opacity-50"
          aria-label="提交"
          disabled={submitting}
          onClick={onSubmit}
        >
          <ArrowUp className="size-4" />
        </button>
      </div>
      {children}
    </section>
  );
}
