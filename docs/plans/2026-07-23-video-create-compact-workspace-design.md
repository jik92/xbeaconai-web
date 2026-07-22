# Video Create Compact Workspace Design

## Scope

Redesign `/aigc/video-create` as a compact two-column product workspace while preserving every existing field,
API call, project status, script and storyboard operation, history action, polling behavior, and generated result.
No server contract, generated SDK file, or business workflow changes.

## Layout

- Use a full-height white workspace with a fixed desktop configuration column of approximately 360px and a flexible output column.
- Give each column one compact 52px toolbar separated by hairline borders.
- Keep the configuration body independently scrollable and the primary generation action fixed at its bottom.
- Keep the output body independently scrollable; script and storyboard tabs stay in its toolbar.
- At tablet widths, narrow the configuration column without changing the workflow. Below the mobile breakpoint, stack the
  configuration and output regions vertically and allow normal page scrolling.

## Configuration Panel

- Remove the English eyebrow and decorative project framing. The toolbar contains only `新建项目` and a compact reset action.
- Keep product media, portrait, scene, product name, selling points, duration, segment count, and speech speed visible.
- Retain `广告诉求`, `脚本风格`, and `高级设置` as compact collapsible groups with selected counts.
- Use shared shadcn `Button`, `Input`, `Label`, and `NativeSelect` primitives where their behavior matches the existing control.
- Render selectable values as restrained pill controls using Tailwind classes and the design-system ink active state.
- Use one ink primary action. AI parameter analysis remains secondary and no longer uses a blue branded surface.

## Output Panel

- Use compact tabs for scripts and storyboards, with counts presented as neutral badges.
- Empty, generating, and error states remain functional but lose decorative color blocks and explanatory excess.
- Script sections use white surfaces, hairline separators, compact metadata, and shadcn buttons for copy, regenerate, and save.
- Storyboard rows retain all media, upload, generation, audio, subtitle, composition, and download actions while reducing padding
  and replacing custom button treatments with shared variants.
- The history drawer uses the same title-only compact dialog hierarchy and neutral status presentation.

## Visual System

- Follow `DESIGN.md`: off-white/white surfaces, warm near-black ink, neutral hairlines, `text-sm` product typography, and pill CTAs.
- Remove the page-specific blue, blue tint, colored shadow, raw hex text colors, English labels, and parallel button reset rules.
- Prefer Tailwind utility classes directly in TSX. Keep CSS only for structural rules that are materially clearer there, such as
  the full-height grid, media aspect behavior, complex storyboard columns, and responsive stacking.
- Do not add subtitles, taglines, atmospheric decoration, or new functionality.

## State and Error Handling

All state remains owned by `VideoCreatePage`. React Query keys, polling intervals, mutations, validation, optimistic status changes,
error extraction, history selection, and attachment behavior remain unchanged. Refactoring visual primitives must not alter disabled
conditions or allow duplicate actions while a task is busy.

## Validation

- Run Biome on the changed page, retained stylesheet, and affected tests.
- Run the relevant unit tests, TypeScript type checking, and the production build.
- Run the typography enforcement check because page-specific typography CSS is being removed.
- Do not run E2E unless the user explicitly requests it.

## Acceptance Criteria

1. The existing end-to-end video creation workflow and all controls remain available.
2. The desktop workspace is visibly tighter at 1440x900 and remains usable at 1024x768.
3. Primary and auxiliary actions use shared shadcn buttons wherever possible.
4. The page no longer defines a blue visual system or global button reset.
5. Most presentation lives in Tailwind classes, and the retained CSS is limited to justified structural/media rules.
6. No server, generated API, or data-contract files change.
