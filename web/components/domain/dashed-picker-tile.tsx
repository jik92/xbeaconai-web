import type { ReactNode } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DashedPickerTilePresentation = "compact" | "wide";

export interface DashedPickerTileProps extends Omit<ButtonProps, "children" | "size" | "variant"> {
  title: string;
  description?: string;
  icon?: ReactNode;
  preview?: ReactNode;
  presentation?: DashedPickerTilePresentation;
}

export function DashedPickerTile({
  className,
  title,
  description,
  icon,
  preview,
  presentation = "compact",
  ...props
}: DashedPickerTileProps) {
  const wide = presentation === "wide";

  return (
    <Button
      className={cn(
        "dashed-picker-tile border-dashed text-muted",
        wide
          ? "h-16 w-full justify-start overflow-hidden rounded-lg px-3 text-left"
          : "h-20 w-16 flex-col rounded-lg px-0",
        className,
      )}
      variant="outline"
      size="sm"
      {...props}
    >
      {preview ? (
        <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-muted [&_img]:h-full [&_img]:w-full [&_img]:object-cover">
          {preview}
        </span>
      ) : (
        icon
      )}
      <span className={cn("min-w-0", wide && "flex-1")}>
        <span className={cn("block truncate type-badge", wide && "text-ink")}>{title}</span>
        {description && <span className="mt-0.5 block truncate type-helper text-muted">{description}</span>}
      </span>
    </Button>
  );
}
