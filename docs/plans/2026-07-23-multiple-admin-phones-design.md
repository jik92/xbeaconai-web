# Multiple Admin Phones Design

## Goal

Allow `ADMIN_PHONE` to contain either one mainland phone number or multiple comma-separated phone numbers. Every configured number receives the same administrator permissions.

## Design

- Parse `ADMIN_PHONE` once in `server/env.ts` by splitting on ASCII commas, trimming whitespace, removing empty entries, and deduplicating values in a `Set<string>`.
- Keep the existing default administrator phone when the variable is absent.
- Expose one shared membership check through the parsed environment value. Account summaries and administrator self-disable protection must use the same check.
- Do not persist administrator status in SQLite. The environment remains the source of truth, so configuration changes take effect after a server restart.
- Preserve single-phone compatibility and document the comma-separated format in `.env.example`.

## Error Handling

Empty segments are ignored. Invalid values never match a normalized user phone and therefore do not receive administrator permissions.

## Verification

Add unit coverage for whitespace, empty segments, deduplication, multiple administrators, and self-disable protection. Run relevant unit tests, TypeScript checking, and the production build; do not run E2E unless explicitly requested.
