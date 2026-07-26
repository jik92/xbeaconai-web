# Attachment Picker Button Layout Design

## Goal

Restore a compact, readable attachment picker by removing duplicated button borders and assigning every action an explicit shared shadcn Button semantic.

## Visual Hierarchy

The dialog, directory workspace, search field, and preview column keep structural hairlines. Buttons inside those containers do not draw another box around every item.

- Source tabs, folder-tree rows, and breadcrumbs use `ghost + sm`.
- Folder and asset cards use the ghost interaction surface with no border. Hover and selected background communicate state; selected assets also retain the check icon.
- Header and preview close actions use `ghost + icon-sm`.
- Footer cancel uses `outline + sm`.
- Footer confirmation uses `default + sm`.

## Component Boundaries

`AttachmentPicker` continues to own queries, upload state, selection, preview state, and submission. This change does not alter its data flow or public props.

The TSX declares Button variants and sizes. Attachment-picker CSS owns only dialog geometry, grid/list layout, spacing, truncation, active-row background, and structural borders. It must not redefine Button border, radius, typography, hover, focus, or disabled styling.

## Responsive Behavior

Keep the existing two- or three-column directory layout and the current preview overlay behavior below 900px. Flattening button surfaces must not change the dialog width, scrolling regions, or preview dimensions.

## Verification

- Update the attachment-picker regression test to verify explicit Button semantics.
- Add static coverage that forbids private borders on attachment buttons and allows structural container borders.
- Run the targeted tests, TypeScript typecheck, production build, and full unit suite.
- Do not run E2E unless explicitly requested.
