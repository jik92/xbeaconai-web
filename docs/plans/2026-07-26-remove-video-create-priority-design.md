# Remove Video Create Priority Design

## Goal

Remove the non-functional `口播优先 / 画面优先` option from one-click video creation. The setting is currently stored but is not consumed by storyboard generation, media generation, narration, subtitles, or composition.

## Scope

- Remove the priority selector from the storyboard editor header.
- Remove `priority` from the new-project input defaults.
- Remove `priority` from `VideoCreateInputSchema` and the generated OpenAPI and web SDK contracts.
- Remove Store logic that preserves the field while applying an AI recommendation.
- Remove the field from scripts, fixtures, and assertions that represent video-create input.
- Keep unrelated uses of the English word `priority` unchanged.

## Compatibility

Existing projects may contain `priority` in their serialized input JSON. Zod object parsing strips unknown keys, so old records remain readable without a database migration. Saving an existing project naturally removes the obsolete field from its normalized input.

## Verification

- Search the source and generated contracts for remaining video-create priority references.
- Regenerate `openapi/openapi.json` and `web/api/generated/` through the project scripts.
- Run relevant video-create tests.
- Run `make ci`, `bun run typecheck`, and `bun run build`.
- Commit only the scoped changes, merge any independent remote updates, push `main`, and verify local/remote SHA equality.
