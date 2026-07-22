# Video Cut Compact Mode Design

## Goal

Refactor `/tools/video-cut` into a border-light compact workspace that uses Tailwind utilities and the existing shadcn-style UI primitives instead of page-specific CSS.

## Layout

- Remove the page card border, table outer border, shadows, and floating count badge.
- Keep only subtle row dividers where they improve scanability.
- Use compact page padding, control gaps, table headers, and table rows.
- Place the task count in normal document flow below the table.
- Preserve the full-height task workspace so the table consumes the available viewport.

## Components

- Extend `DataTable` with a reusable compact, borderless presentation rather than styling video-cut selectors.
- Extend `TaskSearchFilters` compact mode to use small shadcn `Button`, `Input`, and `NativeSelect` controls.
- Use shadcn `Button` and `NativeSelect` inside the video-cut creation form.
- Keep the shared upload picker and all existing business behavior.

## CSS Migration

- Delete all `.video-cut-*` and `.creator-video-cut` rules from `web/styles/globals.css`.
- Express video-cut layout in component Tailwind class names.
- Keep shared structural CSS only where the surrounding legacy `ModulePage` still depends on it.

## Behavior

Task creation, filtering, upload, folder selection, progress, preview, retry, cancel, and result actions remain unchanged.

## Validation

- Run relevant unit tests.
- Run typography enforcement, TypeScript type checking, and production build.
- Do not run E2E unless the user explicitly requests it.
