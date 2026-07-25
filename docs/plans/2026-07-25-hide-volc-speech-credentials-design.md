# Hide Volc Speech credentials from active business administration

## Goal

Remove Volc Speech from the active credential-management UI and the default Provider Doctor run while retaining its
stored credentials and backend implementation for historical voice-clone retries.

## Behavior

- The credential-management API does not return `VOLC_SPEECH_API_KEY_ID` or `VOLC_SPEECH_API_KEY` in the normal
  masked credential list.
- The administrator Web table therefore does not show editable Volc Speech credential rows.
- `检测全部` does not run the Volc Speech Doctor probe and Volc Speech does not appear in Doctor results.
- Volc TOS remains visible and remains part of Doctor checks because Qwen voice cloning depends on it for file storage.
- Existing Volc Speech values remain stored and readable by the backend so historical tasks can still retry.
- Volc Speech Provider, Worker handler, scripts, credential names, import/export compatibility, and stored data remain.

## Implementation

Define the active credential-management catalog as the existing catalog excluding `volc-speech`. Use it for masked
credential listing and the default Doctor Provider list. Keep the complete credential-name catalog for parsing legacy
imports, storage, and historical execution.

## Tests

- Credential listing omits both Volc Speech fields but retains Qwen Audio and TOS.
- Default Doctor providers omit Volc Speech and retain Qwen Audio and TOS.
- Existing custom Doctor unit tests remain able to inject a Volc Speech provider, proving the generic Doctor engine
  still supports historical/internal usage.
- Run the full unit suite, TypeScript typecheck, and production build.

