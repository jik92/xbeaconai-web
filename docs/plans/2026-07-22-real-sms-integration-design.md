# Real SMS integration design

## Goal

Connect registration and password-reset verification codes to Volcengine SMS. Both purposes use template
`SPT_09a29a26`, message group `8c444a41`, and signature `杭州絮缕科技`.

## Configuration

Keep the non-secret SMS account, signature, and shared template ID in `APP_CONFIG.providerDefaults`. Reuse the
existing Volcengine account access key and secret stored as the TOS BYOK credentials because the same key pair has
been verified against the SMS API. Do not place credentials in public configuration.

## Runtime wiring

Keep `AccountStore` dependency injection unchanged for isolated unit tests. The application-level account store
receives a real SMS sender unless `SMS_VERIFICATION_FIXED_CODE` is configured. Fixed-code environments use the
console sender so Playwright and local deterministic tests never send real messages.

The shared sender ignores the business purpose when selecting a template: registration and password reset both use
`SPT_09a29a26`. The purpose remains part of the persisted verification challenge so codes cannot be reused across
flows.

## API and UI behavior

Real SMS responses contain only expiry and resend timing. The plaintext verification code is included only when the
fixed-code test setting is active. OpenAPI models this field as optional, and the UI displays it only when present.

Provider failures remove the newly persisted verification challenge and return a structured, retryable
`SMS_PROVIDER_ERROR` response with HTTP 503. Credentials and upstream response bodies are never returned to the
browser.

## Verification

Add unit coverage for real sender configuration, the shared template, provider error mapping, and conditional code
exposure. Regenerate OpenAPI and the generated SDK, then run focused tests, type checking, and the production build.
Run Playwright authentication coverage to ensure fixed-code tests stay offline.
