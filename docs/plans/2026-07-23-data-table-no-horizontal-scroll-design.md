# DataTable No Horizontal Scroll Design

- Remove `minWidth` from the shared `DataTable` API and every caller.
- Normalize TanStack column sizes into percentages so all columns fit the available width.
- Hide horizontal overflow and truncate long single-line cell content.
- Keep every column visible and preserve vertical scrolling, data, empty states, and actions.
- Validate without E2E unless explicitly requested.
