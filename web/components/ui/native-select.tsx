import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function NativeSelect({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <span className="relative inline-flex max-w-full flex-none items-center">
      <select
        data-slot="native-select"
        className={cn(
          "h-9 w-auto max-w-full min-w-0 appearance-none rounded-md border border-line bg-transparent px-3 py-1 pr-8 text-sm text-ink outline-none transition-colors [field-sizing:content] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 size-4 text-muted" aria-hidden="true" />
    </span>
  );
}
