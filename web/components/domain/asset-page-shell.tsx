import { Search } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface AssetPageShellProps {
  sidebar?: ReactNode;
  toolbar: ReactNode;
  count: number;
  children: ReactNode;
}

export function AssetPageShell({ sidebar, toolbar, count, children }: AssetPageShellProps) {
  return (
    <main className="flex h-[calc(100vh-80px)] min-h-[520px] overflow-hidden bg-white p-3">
      {sidebar && <div className="mr-3 w-56 shrink-0 overflow-hidden">{sidebar}</div>}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex-none">{toolbar}</div>
        <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
        <small className="flex flex-none justify-end pt-1 text-2xs text-muted">共 {count} 项</small>
      </section>
    </main>
  );
}

interface AssetPageToolbarProps {
  query: string;
  onQueryChange: (value: string) => void;
  placeholder: string;
  actionLabel: string;
  onAction: () => void;
  actionIcon?: ReactNode;
  secondaryActions?: ReactNode;
  className?: string;
}

export function AssetPageToolbar({
  query,
  onQueryChange,
  placeholder,
  actionLabel,
  onAction,
  actionIcon,
  secondaryActions,
  className,
}: AssetPageToolbarProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="relative min-w-52 flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <Input
          className="h-8 pl-8"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={placeholder}
        />
      </div>
      {secondaryActions}
      <Button size="sm" onClick={onAction}>
        {actionIcon}
        {actionLabel}
      </Button>
    </div>
  );
}
