# Attachment Picker On-Demand Preview Design

## Scope

Update the shared `AttachmentPicker` library browser so its preview is an on-demand third column. Preserve uploading,
folder navigation, search, MIME filtering, single and multiple selection, and caller-facing APIs.

## Desktop Interaction

- The library source opens with two columns: folder tree and file browser.
- Clicking a file both updates its selected state and sets it as the preview target.
- Once a preview target exists, a fixed-width preview column appears on the right and the dialog expands to its three-column width.
- Clicking another file replaces the preview content without closing the column.
- Clicking an already selected file removes it from the selection but keeps it visible in the preview.
- Hovering or focusing a row never opens or switches the preview.
- Changing folders clears selection and preview, returning the browser to two columns.
- The preview column has an explicit close action that clears only the preview target, not the current selection.

## Responsive Interaction

At narrow widths, the preview appears as a right-side overlay inside the dialog instead of squeezing three columns into the
available width. Closing the preview restores the file list. Folder and upload behavior remains unchanged.

## Layout

- Folder tree: compact fixed column.
- File browser: flexible main column containing search, breadcrumbs, child folders, and file rows.
- Preview: approximately 280px, separated by a single hairline border.
- The empty preview placeholder is removed because the third column does not exist before a file is clicked.
- Dialog width transitions between the existing two-column width and a wider three-column width without changing its height.

## State and Accessibility

- `previewId` is the only source of preview visibility; selected files no longer implicitly create a preview.
- The preview region remains `aria-live="polite"` and gains an accessible close button.
- Keyboard activation of a focused file behaves exactly like pointer activation because both use the same button click handler.
- Existing disabled and submit states remain based on `selected`, not `previewId`.

## Validation

- Add focused component or source-level coverage for hidden-by-default preview, click-to-open behavior, removal of hover/focus
  preview triggers, and independent preview close behavior.
- Run Biome on changed files, relevant unit tests, TypeScript type checking, and the production build.
- Do not run E2E unless explicitly requested.

## Acceptance Criteria

1. The material library initially renders only the folder and file columns.
2. A file click selects it and opens the third preview column.
3. Hover and focus do not change preview content.
4. Closing preview does not clear selected files.
5. Folder changes clear preview and return to the two-column layout.
6. Upload mode and every `AttachmentPicker` caller retain their current behavior.
