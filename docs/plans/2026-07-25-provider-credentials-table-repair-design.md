# Provider credentials table repair

## Context

The local database records all currently tracked Drizzle migrations, but an older migration history omitted the migration that creates `provider_credentials`. The BYOK environment key is present, but listing credentials fails because the table does not exist.

## Decision

Extend the existing idempotent startup compatibility repairs to create `provider_credentials` and `provider_credential_checks` when either is missing. This resolves affected historical databases independently of their stale migration record while leaving correctly migrated databases unchanged.

## Verification

Add a database-bootstrap test that removes `provider_credentials` after migrations have been recorded, reopens the database, and confirms the recreated table accepts a credential row.
