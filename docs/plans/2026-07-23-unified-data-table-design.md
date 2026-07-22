# Unified DataTable Design

- `DataTable` has one shared shadcn-style appearance across the system.
- Remove visual variants such as `compact` and `borderless`.
- Use no outer card border, radius, shadow, or component-owned background.
- Keep one compact header/cell spacing scale and subtle horizontal row separators.
- Pages control only layout and background; `/tools/video-cut` uses a white page background.
- Preserve table data, scrolling, empty states, and actions.
- Validate with static checks, relevant unit tests, type checking, and build. Do not run E2E by default.
