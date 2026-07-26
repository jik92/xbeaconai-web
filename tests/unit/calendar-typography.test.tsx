import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Calendar } from "../../web/components/ui/calendar";

describe("calendar typography", () => {
  test("overrides third-party visual sizes with semantic product roles", () => {
    const selected = new Date(2026, 6, 12);
    const html = renderToStaticMarkup(
      <Calendar defaultMonth={selected} mode="single" selected={selected} showWeekNumber />,
    );

    expect(html).toContain("type-section-title");
    expect(html).toContain("type-body-strong");
    expect(html).toContain("type-label");
    expect(html).toContain("type-helper");
  });
});
