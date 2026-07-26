import { ArrowUp, Expand, FileAudio, FileImage, FileVideo, Plus, Shrink, Trash2 } from "lucide-react";
import { useRef, useState, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/utils";
import { AttachmentPicker, type AttachmentSelection } from "./attachment-picker";

export interface PromptReference {
  id: string;
  name: string;
  kind: "image" | "video" | "audio";
  previewUrl?: string;
}

/** A controlled prompt mention. The label is also the text persisted in the prompt, for example `Image1`. */
export interface PromptMention {
  id: string;
  label: string;
  name: string;
}

function activeMentionQuery(value: string, caret: number) {
  const beforeCaret = value.slice(0, caret);
  const match = beforeCaret.match(/(^|[^A-Za-z0-9_-])@([A-Za-z0-9_-]*)$/);
  if (!match) return undefined;
  return { start: caret - match[2].length - 1, query: match[2] };
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
  submitLabel,
  showSubmit = true,
  mentions = [],
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
  submitLabel?: string;
  showSubmit?: boolean;
  /** Enables a lightweight `@` picker in the textarea. The parent remains the source of truth for the prompt. */
  mentions?: PromptMention[];
  onChooseAssets: (assets: AttachmentSelection[]) => void;
  onRemoveReference: (id: string) => void;
  onPromptChange: (value: string) => void;
  onExpandedChange: (expanded: boolean) => void;
  onSubmit: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [mention, setMention] = useState<{ start: number; end: number; query: string }>();
  const matchingMentions = mention
    ? mentions.filter((item) => item.label.toLowerCase().includes(mention.query.toLowerCase()))
    : [];
  const selectMention = (item: PromptMention) => {
    if (!mention) return;
    const next = `${prompt.slice(0, mention.start)}@${item.label} ${prompt.slice(mention.end)}`;
    const caret = mention.start + item.label.length + 2;
    onPromptChange(next);
    setMention(undefined);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(caret, caret);
    });
  };
  return (
    <section
      className={cn(
        "ag-composer absolute left-1/2 top-31 z-20 h-51 w-[min(900px,calc(100%-32px))] -translate-x-1/2 rounded-xl border border-line bg-white p-4 shadow-sm transition-[height,top]",
        expanded && "expanded h-107.5",
        docked && "bottom-11 top-auto",
        embedded && "embedded relative inset-auto w-full translate-x-0 shadow-none",
      )}
    >
      <div className="ag-reference-row flex h-18 items-start gap-2 overflow-x-auto">
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
            {reference.previewUrl && reference.kind === "image" ? (
              <img
                className="size-11 shrink-0 rounded-sm object-cover"
                src={reference.previewUrl}
                alt={reference.name}
              />
            ) : reference.kind === "image" ? (
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
        ref={(node) => {
          textareaRef.current = node;
          if (inputRef) inputRef.current = node;
        }}
        aria-label={inputLabel}
        placeholder={placeholder}
        value={prompt}
        className={cn(
          "absolute left-20.5 right-9.5 top-4 h-30 w-[calc(100%-126px)] resize-none bg-transparent text-sm leading-relaxed text-ink outline-none placeholder:text-muted-soft",
          expanded && "h-86.5",
        )}
        onChange={(event) => {
          const value = event.target.value;
          onPromptChange(value);
          const query = activeMentionQuery(value, event.target.selectionStart);
          setMention(query ? { ...query, end: event.target.selectionStart } : undefined);
        }}
        onClick={(event) => {
          const query = activeMentionQuery(event.currentTarget.value, event.currentTarget.selectionStart);
          setMention(query ? { ...query, end: event.currentTarget.selectionStart } : undefined);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && mention) {
            event.preventDefault();
            setMention(undefined);
            return;
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onSubmit();
          }
        }}
      />
      {mention && (
        <div
          className="ag-mention-picker absolute left-20.5 top-34 z-30 max-h-48 min-w-44 overflow-y-auto rounded-lg border border-line bg-white p-1 shadow-lg"
          role="listbox"
          aria-label="可引用素材"
        >
          {matchingMentions.length ? (
            matchingMentions.map((item) => (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-ink hover:bg-canvas-soft"
                key={item.id}
                role="option"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectMention(item)}
              >
                <b className="font-medium">@{item.label}</b>
                <span className="truncate text-muted">{item.name}</span>
              </button>
            ))
          ) : (
            <p className="px-2 py-1.5 text-xs text-muted">没有匹配的素材</p>
          )}
        </div>
      )}
      <button
        type="button"
        className="ag-expand absolute right-2.5 top-3 grid size-6 place-items-center rounded-md border border-line bg-white text-muted"
        aria-label={expanded ? "收起输入框" : "展开输入框"}
        onClick={() => onExpandedChange(!expanded)}
      >
        {expanded ? <Shrink className="size-3.5" /> : <Expand className="size-3.5" />}
      </button>
      <div className="ag-parameters absolute bottom-4 left-4 right-4 flex items-center justify-between">
        <div className="flex gap-1 [&>button]:flex [&>button]:h-9 [&>button]:items-center [&>button]:gap-1 [&>button]:rounded-md [&>button]:border [&>button]:border-line [&>button]:bg-white [&>button]:px-3 [&>button]:text-xs [&>button]:text-ink [&_svg]:size-3.5">
          {controls}
        </div>
        {showSubmit && (
          <button
            type="button"
            className={cn(
              "ag-send flex h-8.5 items-center justify-center gap-1.5 rounded-full bg-primary px-2.5 text-xs text-white disabled:opacity-50",
              !submitLabel && "w-8.5 px-0",
            )}
            aria-label="提交"
            disabled={submitting}
            onClick={onSubmit}
          >
            <ArrowUp className="size-4" />
            {submitLabel && <span>{submitLabel}</span>}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}
