# Qwen-only voice clone business entry design

## Goal

Make Qwen Audio the only provider available for newly created voice-clone tasks while preserving existing Volcengine
implementation code and allowing historical Volcengine tasks to be retried.

## Product behavior

- The voice-clone page exposes one action: `新建音色人物`.
- That action opens only the existing Qwen voice-clone modal.
- The Web application no longer renders or exposes the Volcengine voice-clone creation form.
- Newly submitted voice-clone jobs must use `voiceProvider: "qwen"`.
- Attempts to create a new Volcengine voice-clone job through the API return a structured, user-readable validation error.
- Existing Volcengine job records remain visible and retryable.

## Architecture boundaries

### Web

Remove the legacy Volcengine creation path from the voice-clone module page. Keep the Qwen modal as the sole creation
surface and use provider-neutral user-facing labels where the provider does not need to be exposed.

### API

The generic job creation route treats `voice-clone` as a Qwen-only module. It validates the Qwen request contract and
rejects missing or non-Qwen `voiceProvider` values before queueing.

The retry route remains compatible with persisted historical jobs. It may recreate a Volcengine job from an existing
Volcengine record, but this exception is not available to ordinary new-job submissions.

### Worker and providers

Keep both Qwen and Volcengine Worker handlers registered. The Qwen handler processes new Qwen jobs; the Volcengine
handler exists only so historical Volcengine retries can still execute.

Keep Volcengine Provider code, scripts, credential definitions, and diagnostics. They are implementation assets, not a
new-task business entry.

### Feature availability

The visible voice-clone feature is available only when the Qwen Audio and required TOS capabilities are verified.
Volcengine credentials no longer make the visible voice-clone creation feature available.

## Error handling

A new non-Qwen voice-clone submission is rejected synchronously with the project's structured API error shape. The
message states that new voice-clone tasks support Qwen only, so users do not receive a queued task that later fails in
the Worker.

## Tests

- Web source contract: only one voice-clone creation action and only the Qwen modal are exposed.
- API validation: Qwen creation succeeds validation; new Volcengine creation is rejected.
- Retry compatibility: the Volcengine Worker handler remains registered and continues to match historical jobs.
- Feature gate: voice-clone availability depends on verified Qwen Audio plus TOS, not Volcengine speech.
- Run relevant unit tests, TypeScript typecheck, and production build. Do not run E2E unless explicitly requested.

