# Enabled Tool Pages Shared Layout Design

## Scope

Align every enabled page under **AI 工具箱** and **实用工具** with `/tools/video-cut`.

Included by the current `APP_CONFIG.menuFeatures` values:

- `/tools/video-cut`
- `/tools/video-mashup`
- `/tools/voice-clone`
- `/tools/subtitle-erase`
- `/tools/video-enhancement`
- `/utilities/video-extract`

Pages whose feature flag is `false` are explicitly out of scope and retain their current route and implementation. The migration must be driven by the feature group and enabled state rather than by a second hard-coded menu inventory.

## Shared Page Structure

Create `web/components/domain/tool-task-page.tsx` as the single task-list page skeleton.

The skeleton owns only presentation and layout:

- white full-width page surface;
- compact `p-3` page padding;
- one toolbar row containing `TaskSearchFilters compact` and a shadcn `Button size="sm"`;
- one shared `DataTable` filling the remaining viewport height;
- normal-flow task count below the table;
- shared loading, error, filtered-empty, and first-task states;
- no page title, subtitle, description, card shell, table outer border, shadow, or horizontal scrollbar.

The skeleton accepts business behavior through props:

```ts
interface ToolTaskPageProps<TData> {
  rows: TData[];
  columns: ColumnDef<TData, unknown>[];
  getRowId: (row: TData) => string;
  primaryAction: { label: string; onClick: () => void; disabled?: boolean };
  onSearch: (filters: TaskSearchFilterValue) => void;
  loading?: boolean;
  error?: unknown;
  emptyMessage: string;
  emptyActionLabel?: string;
}
```

The component must not know module IDs, submit jobs, fetch data, interpret results, or choose action labels.

## Shared Creator Modal

Extract the current compact shell into `web/components/domain/tool-creator-modal.tsx`.

The modal owns:

- centered overlay;
- one `max-w-lg` white shell;
- 52px title-only header and close button;
- scrollable `text-sm` content area;
- functional error row;
- 52px footer using shadcn small buttons;
- responsive full-width behavior.

It accepts title, open state, close behavior, content, errors, and footer actions. It never adds a subtitle or description. Feature pages keep ownership of fields, validation, submission, multi-step state, and button logic.

## Page Adapters

### Existing ModulePage tools

`video-cut`, `voice-clone`, `subtitle-erase`, and `video-enhancement` continue using their existing job queries and creator form logic. `ModulePage` delegates the list surface to `ToolTaskPage` and its dialog shell to `ToolCreatorModal`.

The shared table columns remain the canonical default for these four tools. Row actions continue calling the existing preview, retry, cancel, export, and result handlers.

### Video mashup

`VideoMashupPage` keeps:

- video group state and attachment selection;
- combination validation and theoretical result count;
- folder selection and job submission;
- polling;
- artifact preview and authenticated downloads.

Its landing dashboard is replaced by `ToolTaskPage`. Its table adapter supplies task name, status, progress, result count, created time, and feature-specific result actions. “新建任务” opens its existing group editor inside `ToolCreatorModal`; “查看结果” opens a feature-owned result dialog/drawer rather than restoring the old split dashboard.

### Video extract

`VideoExtractPage` keeps:

- merged `video-extract` and `share-content-import` queries;
- URL/share-text parsing and classification;
- multi-candidate selection;
- recognition-only platform behavior;
- folder selection and submission;
- polling and result-link semantics.

Its custom job rows are replaced by a `ToolTaskPage` table adapter. The input step and candidate-selection step render inside `ToolCreatorModal`. No parser, routing, or provider behavior moves into the shared layout.

## Filtering

Each page stores its own `TaskSearchFilterValue` and filters its own rows before passing them to `ToolTaskPage`. The shared filter semantics are task name, status, and creation date. Video extract applies the same filters to the merged job list. No “创建人” field appears in compact mode.

## Reuse and Routing

- `router.tsx` keeps dedicated components for video mashup and video extract because they own specialized workflows.
- Shared visuals are achieved through composition, not by routing every page to `ModulePage`.
- Button labels and click behavior remain feature-owned.
- `APP_CONFIG` remains the only feature availability source.
- No generated API files or server contracts change.

## CSS Migration

- Express the shared skeleton and modal in Tailwind/shadcn classes.
- Remove task-list, page-shell, and modal-shell CSS from `video-mashup.css`, `video-extract-page.css`, and `globals.css` after each consumer migrates.
- Keep only feature-specific media grids, candidate lists, group editors, and result presentation styles that cannot be expressed by the shared primitives yet.
- Do not add module-specific overrides to the shared table or modal.

## Accessibility and Behavior

- The primary action and empty action invoke the same feature-owned callback.
- Modal close works through close button and backdrop; existing submit disabling remains intact.
- Table action buttons keep accessible labels and keyboard behavior.
- Content truncation exposes existing `title` or accessible text where necessary.
- No business operation changes merely because its layout moves.

## Validation

- Add unit coverage for the shared page skeleton: primary action, empty action, count, filtering callback, loading/error forwarding, and no horizontal overflow API.
- Add unit coverage for the shared modal: title-only header, close actions, error row, disabled submit action, and absence of subtitle/description.
- Preserve and run video mashup planning tests, video extract route-input tests, result preview tests, and affected component tests.
- Run typography enforcement, TypeScript type checking, and production build.
- Do not run E2E unless the user explicitly requests it.

## Acceptance Criteria

1. Every currently enabled AI-toolbox and utility landing page has the same white compact toolbar/table/count layout as video cut.
2. All six pages use the same `ToolTaskPage` implementation; no copied shell markup remains.
3. All task-creation dialogs use `ToolCreatorModal`; only form content and button behavior differ.
4. Video mashup and video extract retain their complete specialized workflows.
5. Disabled feature pages are unchanged.
6. No title subtitle, description, card border, table outer border, or horizontal scrollbar is introduced.
7. Targeted tests, typography check, type check, and build pass without running E2E.
