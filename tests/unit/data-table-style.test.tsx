import { describe, expect, test } from "bun:test";
import type { ColumnDef } from "@tanstack/react-table";
import { renderToStaticMarkup } from "react-dom/server";
import { DataTable } from "../../web/components/ui/data-table";

interface Row {
  id: string;
  name: string;
}

describe("shared DataTable styling", () => {
  test("uses a muted sticky header without content row dividers", () => {
    const columns: ColumnDef<Row, unknown>[] = [{ accessorKey: "name", header: "名称" }];
    const html = renderToStaticMarkup(<DataTable columns={columns} data={[{ id: "1", name: "测试素材" }]} />);

    expect(html).toContain("[&amp;_tr]:border-b [&amp;_tr]:border-line");
    expect(html).toContain("sticky top-0 z-10 h-10");
    expect(html).toContain("bg-surface-muted");
    expect(html).toContain("type-label text-ink");
    expect(html).toContain("transition-colors hover:bg-surface-muted/50");
    expect(html).toContain("h-14 max-w-0 overflow-hidden border-0");
    expect(html).not.toContain("border-line/60");
    expect(html).not.toContain("[&amp;_tr:last-child]:border-0");
  });
});
