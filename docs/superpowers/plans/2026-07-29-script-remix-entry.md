# Script Remix Entry Implementation Plan

**Goal:** Add a Script Remix navigation entry that reuses the existing video-remix workflow.

**Architecture:** Register a direct route outside the generated module list and pass a title prop to `RemixProject`. Add one static sidebar item so the new route is discoverable without changing generated `ModuleId` types or backend contracts.

### Task 1: Prove the route and menu contract

- [ ] Add a focused unit assertion that `/aigc/script-remix`, the “脚本二创” menu label, and `workflowTitle="脚本二创"` are present.
- [ ] Run the test and confirm it fails before implementation.

### Task 2: Reuse the existing workflow component

- [ ] Add a `workflowTitle?: string` prop to `RemixProject`, use it for the header and the new-project default title.
- [ ] Register a direct `script-remix` route that renders `<RemixProject workflowTitle="脚本二创" />`.
- [ ] Add the reusable sidebar item under “创作工作流”.
- [ ] Run focused tests, typecheck, and production build.
