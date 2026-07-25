# Legacy user-status constraint repair

## Context

Some local SQLite databases were initialized while `users.status` allowed only `active` and `disabled`. The registration flow now creates accounts in `pending_password`, causing those databases to reject registration with a SQLite CHECK-constraint error.

## Decision

At database startup, inspect the `users` table definition. When it contains a legacy CHECK constraint that omits `pending_password`, rebuild only the `users` table inside an immediate transaction, preserving rows and allowing `pending_password`, `active`, and `disabled`. Databases without a CHECK constraint or with the current constraint are already compatible and remain untouched.

## Verification

Add a unit test that converts a fresh database to the legacy constrained shape, reopens it through the normal database bootstrap, verifies the existing user remains, and verifies that a pending-password user can be inserted.
