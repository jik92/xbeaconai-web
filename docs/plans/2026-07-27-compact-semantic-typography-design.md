# Compact Semantic Typography Design

## Goal

Unify product-interface typography by content meaning instead of allowing each page to choose an arbitrary visual size. All visible product text uses a compact 10px, 12px, or 14px scale with predictable weights.

## Semantic Roles

| Role | Size / Line Height | Weight | Usage |
| --- | --- | --- | --- |
| Page title | 14px / 20px | 600 | The single primary title of a product page |
| Section, dialog, and card title | 14px / 20px | 500 | Content headings below the page level |
| Body | 14px / 20px | 400 | Default copy, inputs, navigation, and table cells |
| Strong body and primary action | 14px / 20px | 500 | Emphasized copy and primary actions |
| Field label and table heading | 12px / 16px | 500 | Form labels and column headings |
| Helper and metadata | 12px / 16px | 400 | Descriptions, hints, timestamps, and counts |
| Badge and compact action | 12px / 16px | 500 | Status labels, tags, and secondary compact actions |
| Micro label | 10px / 14px | 400 or 500 | Media overlays, timecodes, and canvas scales only |

Error, warning, success, and disabled states inherit the typography role of their content. State is communicated through semantic color rather than a larger size or heavier weight.

## Implementation

- Define reusable semantic typography utilities in `web/styles/tailwind.css`.
- Migrate TSX and legacy CSS from visual `text-*` and `font-*` combinations to semantic roles.
- Remove `text-base` through `text-6xl` from product UI.
- Reclassify every existing `text-2xs` occurrence; keep 10px only for genuinely constrained overlays, timecodes, and canvas annotations.
- Remove the global `strong` 600-weight override so emphasis does not unexpectedly change hierarchy.
- Extend `scripts/check-typography.ts` and its unit tests to enforce the compact scale and reject direct visual size/weight combinations outside the typography source of truth.

## Validation

- Verify semantic typography guard tests.
- Run the typography checker, relevant unit tests, TypeScript type checking, and the production build.
- Audit all remaining 10px usages and confirm that no product text exceeds 14px.
- Do not run E2E unless explicitly requested.
