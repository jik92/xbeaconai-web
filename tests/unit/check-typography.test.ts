import { describe, expect, test } from "bun:test";
import { typographyViolationsForSource } from "../../scripts/check-typography";

describe("Tailwind typography guard", () => {
  test("accepts semantic typography roles and the native control reset", () => {
    expect(
      typographyViolationsForSource(
        "web/example.css",
        ".copy { @apply type-body leading-relaxed text-body; }\n.label { @apply type-label; }\nfont: inherit;",
      ),
    ).toEqual([]);
  });

  test("rejects raw typography, raw colors, numeric leading, and unapproved families", () => {
    const violations = typographyViolationsForSource(
      "web/example.css",
      [".copy { font-style: normal; }", ".copy { color: #172033; }", ".copy { @apply font-mono leading-6; }"].join(
        "\n",
      ),
    );
    expect(violations).toHaveLength(3);
  });

  test("rejects direct visual sizes and weights even when they are in the compact scale", () => {
    expect(typographyViolationsForSource("web/example.tsx", '<p className="text-sm font-normal" />')).toHaveLength(1);
    expect(typographyViolationsForSource("web/example.tsx", '<h1 className="text-2xl font-semibold" />')).toHaveLength(
      1,
    );
  });

  test("rejects inline typography styles and arbitrary typography utilities", () => {
    expect(
      typographyViolationsForSource(
        "web/example.tsx",
        '<p className="text-' + '[13px]" style={{ fontWeight: 700, color: "red" }} />',
      ),
    ).toHaveLength(1);
  });

  test("rejects built-in chromatic palette and gradient utilities", () => {
    expect(
      typographyViolationsForSource("web/example.tsx", '<p className="bg-gradient-to-br from-blue-500 text-white" />'),
    ).toHaveLength(1);
  });

  test("limits micro typography to audited media and canvas files", () => {
    expect(typographyViolationsForSource("web/example.tsx", '<span className="type-micro" />')).toHaveLength(1);
    expect(
      typographyViolationsForSource(
        "web/components/domain/media-preview.tsx",
        '<span className="type-micro" role="timer" />',
      ),
    ).toEqual([]);
  });
});
