# Strict Product TOS Upload Design

## Goal

Product images are usable only after every file has been uploaded to private TOS successfully. Local files must not act as a successful fallback.

## Upload Flow

- Require the persisted TOS Doctor result to be available before accepting `POST /api/products`.
- Stage each validated image in the local upload directory, upload it to an owner-scoped TOS key, and track completed objects.
- If any upload fails, remove every completed TOS object and all staged local files. Return a structured upload error and create no product or asset rows.
- After every upload succeeds, create the product and ordered asset rows in one SQLite transaction, then remove staged local files.
- If database creation fails after TOS succeeds, remove the uploaded TOS objects before returning an error.

## Reading Existing Assets

New product images are read from TOS through the existing authenticated content endpoint and short-lived signed redirect. Existing local assets remain readable for migration compatibility, but local storage is not used as a fallback for new uploads.

Use only RFC 5987 `filename*=UTF-8''...` encoding for local legacy responses. Do not emit an ASCII `filename` fallback.

## Verification

Add unit coverage for strict upload rollback and UTF-8 content disposition. Run targeted unit tests, TypeScript checking, and the production build. Do not use browser tooling or E2E tests.
