import { ArrowUp, Expand, FileAudio, FileImage, FileVideo, Plus, Shrink, Trash2 } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import "@/features/ai-generate/ai-generate.css";

export interface PromptReference {
  id: string;
  name: string;
  kind: "image" | "video" | "audio";
}

export function PromptWorkbench({
  expanded,
  docked = false,
  references,
  prompt,
  placeholder,
  inputLabel,
  inputRef,
  fileInputRef,
  accept = "image/*,video/*,audio/*",
  multiple = true,
  controls,
  children,
  submitting = false,
  onChooseFiles,
  onRemoveReference,
  onPromptChange,
  onExpandedChange,
  onSubmit,
}: {
  expanded: boolean;
  docked?: boolean;
  references: PromptReference[];
  prompt: string;
  placeholder: string;
  inputLabel: string;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  fileInputRef?: RefObject<HTMLInputElement | null>;
  accept?: string;
  multiple?: boolean;
  controls: ReactNode;
  children?: ReactNode;
  submitting?: boolean;
  onChooseFiles: (files: File[]) => void;
  onRemoveReference: (id: string) => void;
  onPromptChange: (value: string) => void;
  onExpandedChange: (expanded: boolean) => void;
  onSubmit: () => void;
}) {
  return (
    <section className={`ag-composer ${expanded ? "expanded" : ""} ${docked ? "docked" : ""}`}>
      <div className="ag-reference-row">
        <input
          ref={fileInputRef}
          hidden
          type="file"
          multiple={multiple}
          accept={accept}
          onChange={(event) => onChooseFiles(Array.from(event.target.files ?? []))}
        />
        <button className="ag-add-reference" aria-label="添加参考素材" onClick={() => fileInputRef?.current?.click()}>
          <Plus />
          <span>参考</span>
        </button>
        {references.map((reference) => (
          <div className="ag-reference" key={reference.id}>
            {reference.kind === "image" ? <FileImage /> : reference.kind === "video" ? <FileVideo /> : <FileAudio />}
            <span>
              <b>{reference.name}</b>
              <small>{reference.kind}</small>
            </span>
            <button aria-label={`移除 ${reference.name}`} onClick={() => onRemoveReference(reference.id)}>
              <Trash2 />
            </button>
          </div>
        ))}
      </div>
      <textarea
        ref={inputRef}
        aria-label={inputLabel}
        placeholder={placeholder}
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onSubmit();
          }
        }}
      />
      <button
        className="ag-expand"
        aria-label={expanded ? "收起输入框" : "展开输入框"}
        onClick={() => onExpandedChange(!expanded)}
      >
        {expanded ? <Shrink /> : <Expand />}
      </button>
      <div className="ag-parameters">
        <div>{controls}</div>
        <button className="ag-send" aria-label="提交" disabled={submitting} onClick={onSubmit}>
          <ArrowUp />
        </button>
      </div>
      {children}
    </section>
  );
}
