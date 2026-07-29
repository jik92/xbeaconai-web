import { ArrowUp, Expand, FileAudio, FileImage, FileVideo, Plus, Shrink, Trash2 } from "lucide-react";
import { type ReactNode, type RefObject, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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

export function promptMentionRanges(value: string, mentions: PromptMention[]) {
  return mentions.flatMap((mention) => {
    const escaped = mention.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`@${escaped}(?![A-Za-z0-9_-])`, "g");
    const ranges: Array<{ start: number; end: number }> = [];
    for (const match of value.matchAll(pattern)) {
      const start = match.index ?? 0;
      ranges.push({ start, end: start + match[0].length });
    }
    return ranges;
  });
}

export function promptMentionDeletionRange(
  value: string,
  mentions: PromptMention[],
  start: number,
  end: number,
  key: "Backspace" | "Delete",
) {
  const ranges = promptMentionRanges(value, mentions);
  const selectedRanges = ranges.filter((range) => start < range.end && end > range.start);
  if (selectedRanges.length > 0)
    return {
      start: Math.min(start, ...selectedRanges.map((range) => range.start)),
      end: Math.max(end, ...selectedRanges.map((range) => range.end)),
    };
  return key === "Backspace"
    ? ranges.find((range) => range.start < start && start <= range.end)
    : ranges.find((range) => range.start <= start && start < range.end);
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
  submitDisabled = false,
  submitDisabledReason,
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
  submitDisabled?: boolean;
  submitDisabledReason?: string;
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
  const replacePromptRange = (start: number, end: number, replacement = "") => {
    const next = `${prompt.slice(0, start)}${replacement}${prompt.slice(end)}`;
    const caret = start + replacement.length;
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
        "ag-composer absolute left-1/2 top-31 z-20 h-51 w-[min(900px,calc(100%-32px))] -translate-x-1/2 rounded-xl border border-line bg-surface p-4 shadow-sm transition-[height,top]",
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
            <Button
              type="button"
              className="flex h-17.5 w-14 shrink-0 -rotate-6 flex-col items-center justify-center gap-0.5 border border-dashed border-line-strong bg-surface text-muted"
              aria-label="添加参考素材"
              onClick={open}
            >
              <Plus className="size-4" />
              <span className="type-helper">参考</span>
            </Button>
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
              <b className="block truncate type-label">{reference.name}</b>
              <small className="mt-0.5 block truncate type-helper text-muted">{reference.kind}</small>
            </span>
            {!lockedReferenceIds.includes(reference.id) && (
              <Button
                type="button"
                className="text-muted"
                aria-label={`移除 ${reference.name}`}
                onClick={() => onRemoveReference(reference.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
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
          "absolute left-20.5 right-9.5 top-4 h-30 w-[calc(100%-126px)] resize-none bg-transparent type-body leading-relaxed text-ink outline-none placeholder:text-muted-soft",
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
        onPaste={(event) => {
          const caret = event.currentTarget.selectionStart;
          const containing = promptMentionRanges(prompt, mentions).find(
            (range) => range.start < caret && caret < range.end,
          );
          if (!containing) return;
          event.preventDefault();
          replacePromptRange(containing.end, containing.end, event.clipboardData.getData("text"));
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && mention) {
            event.preventDefault();
            setMention(undefined);
            return;
          }
          const target = event.currentTarget;
          const start = target.selectionStart;
          const end = target.selectionEnd;
          const ranges = promptMentionRanges(prompt, mentions);
          const containing = ranges.find((range) => range.start < start && start < range.end);
          const deletionRange =
            event.key === "Backspace" || event.key === "Delete"
              ? promptMentionDeletionRange(prompt, mentions, start, end, event.key)
              : undefined;
          if ((event.key === "Backspace" || event.key === "Delete") && deletionRange) {
            event.preventDefault();
            replacePromptRange(deletionRange.start, deletionRange.end);
            return;
          }
          if (containing && event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
            event.preventDefault();
            replacePromptRange(containing.end, containing.end, event.key);
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
          className="ag-mention-picker absolute left-20.5 top-34 z-30 max-h-48 min-w-44 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-lg"
          role="listbox"
          aria-label="可引用素材"
        >
          {matchingMentions.length ? (
            matchingMentions.map((item) => (
              <Button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left type-helper text-ink hover:bg-canvas-soft"
                key={item.id}
                role="option"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectMention(item)}
              >
                <b className="">@{item.label}</b>
                <span className="truncate text-muted">{item.name}</span>
              </Button>
            ))
          ) : (
            <p className="px-2 py-1.5 type-helper text-muted">没有匹配的素材</p>
          )}
        </div>
      )}
      <Button
        type="button"
        className="ag-expand absolute right-2.5 top-3 grid size-6 place-items-center rounded-md border border-line bg-surface text-muted"
        aria-label={expanded ? "收起输入框" : "展开输入框"}
        onClick={() => onExpandedChange(!expanded)}
      >
        {expanded ? <Shrink className="size-3.5" /> : <Expand className="size-3.5" />}
      </Button>
      <div className="ag-parameters absolute bottom-4 left-4 right-4 flex items-center justify-between">
        <div className="flex gap-1 [&>button]:flex [&>button]:h-9 [&>button]:items-center [&>button]:gap-1 [&>button]:rounded-md [&>button]:border [&>button]:border-line [&>button]:bg-surface [&>button]:px-3 [&>button]:type-badge [&>button]:text-ink [&_svg]:size-3.5">
          {controls}
        </div>
        {showSubmit && (
          <Button
            type="button"
            className={cn(
              "ag-send flex h-8.5 items-center justify-center gap-1.5 rounded-full bg-primary px-2.5 type-helper text-on-primary disabled:opacity-50",
              !submitLabel && "w-8.5 px-0",
            )}
            aria-label="提交"
            disabled={submitting || submitDisabled}
            title={submitDisabled ? submitDisabledReason : undefined}
            onClick={onSubmit}
          >
            <ArrowUp className="size-4" />
            {submitLabel && <span>{submitLabel}</span>}
          </Button>
        )}
      </div>
      {children}
    </section>
  );
}
