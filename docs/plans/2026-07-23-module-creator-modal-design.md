# Module Creator Modal Design

- Every `ModulePage` creation flow uses one compact modal shell.
- Use a 52px header/footer, `text-base` title, `text-sm` body, `text-xs` labels/help, and 12px form gaps.
- Use shared shadcn `Button`, `Input`, `Label`, and `NativeSelect` controls.
- Use one responsive form row: 96px label plus flexible control on desktop, one column on small screens.
- Keep uploads, fields, validation, and submit behavior unchanged.
- Remove per-module modal sizing, typography, footer, and hidden legacy-modal markup.
- Show errors in document flow.
- Validate without E2E unless explicitly requested.
