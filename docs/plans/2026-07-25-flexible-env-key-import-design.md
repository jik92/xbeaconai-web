# Flexible credential-file import

## Decision

Credential import validates the uploaded file's presence, size, and parsed allowlisted key-value content. The source filename is not part of the file format and is no longer validated or restricted by the browser file chooser.

## Verification

The API contract regression test asserts that the server no longer contains the fixed `.env.key` filename check.
