import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: The reusable label receives its associated control through props.children.
    <label
      data-slot="label"
      className={cn("flex items-center gap-2 text-sm font-medium leading-none text-ink", className)}
      {...props}
    />
  );
}
