import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ToolCreatorModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function ToolCreatorModal({ open, title, onClose, children }: ToolCreatorModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <section
        className="flex max-h-[calc(100vh-32px)] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex h-13 flex-none items-center justify-between border-b border-line px-4">
          <h2 className="truncate text-base font-medium text-ink">{title}</h2>
          <Button className="size-8" variant="ghost" size="icon" aria-label="关闭" onClick={onClose}>
            <X />
          </Button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </section>
    </div>
  );
}
