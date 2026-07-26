import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface SegmentedControlOption<Value extends string> {
  value: Value;
  label: string;
}

export interface SegmentedControlProps<Value extends string> {
  ariaLabel: string;
  value: Value;
  options: readonly SegmentedControlOption<Value>[];
  onValueChange: (value: Value) => void;
  className?: string;
  fullWidth?: boolean;
}

export function SegmentedControl<Value extends string>({
  ariaLabel,
  value,
  options,
  onValueChange,
  className,
  fullWidth = false,
}: SegmentedControlProps<Value>) {
  return (
    <div
      className={cn("inline-flex rounded-lg bg-surface-muted p-1", fullWidth && "w-full", className)}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Button
            key={option.value}
            className={cn(
              "segmented-control-button rounded-md",
              fullWidth && "flex-1",
              selected && "bg-surface shadow-sm hover:bg-surface",
            )}
            variant="ghost"
            size="sm"
            aria-pressed={selected}
            onClick={() => onValueChange(option.value)}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}
