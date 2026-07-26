# Tailwind Typography and Color Unification

## Goal

Make every product page render text through the typography and color system defined in `DESIGN.md`. The existing
blue-gray visual language will be replaced by the approved warm ink, off-white, and gray-brown palette.

## Source of Truth

`web/styles/tailwind.css` is the only runtime source for font families, type scale, text colors, line heights, tracking,
and approved font weights. Business TSX uses Tailwind utilities directly. Selector-based CSS may retain selectors but
must use `@apply` for text rendering and foreground colors.

## Token Model

- Use the approved Chinese-first `font-sans` stack everywhere. `font-display` remains an alias for approved marketing
  display text only.
- Keep the documented `text-2xs` through `text-6xl` scale and bundled line heights.
- Add every documented foreground, surface, hairline, dark-surface, and atmospheric color as a Tailwind theme token.
- Use `text-ink`, `text-body`, `text-body-strong`, `text-muted`, `text-muted-soft`, `text-on-primary`, `text-on-dark`,
  `text-on-dark-soft`, `text-success`, and `text-error` according to meaning.
- Preserve functional warnings through a restrained semantic warning token only where the interface must distinguish a
  warning from neutral or failed state.

## Migration Rules

- Product roots inherit `font-sans text-sm font-normal`.
- Product page titles use `text-xl` through `text-3xl`; larger sizes remain limited to marketing surfaces.
- Only `font-light`, `font-normal`, `font-medium`, and `font-semibold` are allowed. `font-light` is display-only.
- Only named line-height utilities from `DESIGN.md` are allowed; numeric and arbitrary line heights are removed.
- `font-mono` is removed from product content, including audit JSON and identifiers.
- Raw CSS `font-*`, `line-height`, `letter-spacing`, `font-style`, `text-transform`, and `text-decoration` declarations
  are replaced by Tailwind `@apply`, except the documented `font: inherit` native-control reset.
- Raw foreground `color` declarations in business CSS are migrated to approved Tailwind text tokens. State-specific
  text colors use semantic tokens rather than page-local hex values.
- Existing missing utility references such as `text-body`, `text-muted-soft`, and `text-error` become real generated
  Tailwind utilities.

## Guardrails

`scripts/check-typography.ts` will reject:

- raw typography and foreground-color declarations outside the theme and approved native-control reset;
- inline typography and foreground-color styles;
- arbitrary typography utilities;
- numeric line-height utilities;
- unapproved font families and font weights;
- `font-light` outside explicitly approved display contexts;
- unknown project-specific text color tokens.

Focused unit coverage will exercise both accepted and rejected examples.

## Verification

- Run the strengthened typography check and its unit tests.
- Confirm the production CSS contains all required theme utilities.
- Run `make ci`, `bun run typecheck`, and `bun run build`.
- Inspect the final diff and repeat source scans for prohibited declarations and missing utilities.
- Do not run E2E unless explicitly requested.
