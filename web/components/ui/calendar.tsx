import type { ComponentProps, CSSProperties } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { cn } from "@/lib/utils";

type CalendarStyle = CSSProperties & {
  "--rdp-accent-color"?: string;
  "--rdp-accent-background-color"?: string;
  "--rdp-day_button-border-radius"?: string;
};

export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  style,
  ...props
}: ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("m-0 p-3 type-body", className)}
      classNames={{
        ...classNames,
        day_button: cn("type-body", classNames?.day_button),
        month_caption: cn("type-section-title", classNames?.month_caption),
        selected: cn("type-body-strong", classNames?.selected),
        week_number: cn("type-helper", classNames?.week_number),
        weekday: cn("type-label", classNames?.weekday),
      }}
      style={
        {
          "--rdp-accent-color": "var(--primary)",
          "--rdp-accent-background-color": "var(--primary-soft)",
          "--rdp-day_button-border-radius": "6px",
          ...style,
        } as CalendarStyle
      }
      {...props}
    />
  );
}
