# Seedance FFmpeg Mock Design

## Scope

Add an opt-in `MOCK_GENERATE_VIDEO_API=true` development path for every Seedance video generation request. When enabled,
the Worker must bypass TOS staging and the remote Seedance API, generate a local MP4 with FFmpeg, and return it through the
same artifact pipeline. When disabled, the existing real provider flow remains unchanged.

## Configuration

- Add `mockGenerateVideoApi` to `server/env.ts`, enabled only when `MOCK_GENERATE_VIDEO_API` is exactly `true`.
- Add the documented setting to `.env.example` with a default of `false`.
- Set `MOCK_GENERATE_VIDEO_API=true` in the local ignored `.env` requested by the user without reading or exposing other values.
- The setting is explicit and independent from `FORCE_MOCK` and `ALLOW_MOCK_FALLBACK`.

## FFmpeg Output

Add a focused helper in `server/media/ffmpeg.ts` that creates a standards-compatible MP4:

- black background;
- one random integer from 10 through 99 centered for the complete video;
- duration equal to the normalized Seedance request duration;
- dimensions derived from the requested ratio: 720x1280 for 9:16, 720x720 for 1:1, and 1280x720 for 16:9;
- 24 fps H.264 video in `yuv420p` with a silent AAC stereo track;
- `+faststart` for immediate browser playback.

The centered number uses FFmpeg's text renderer when available. Generation must fail visibly if FFmpeg is unavailable or the
output cannot be probed; it must not silently call the paid provider after a requested Mock fails.

## Seedance Integration

`worker/jobs/job-seedance-video.ts` remains the single Seedance execution boundary.

When Mock is enabled, `execute`:

1. checks cancellation before work;
2. derives the same clamped duration and ratio used by the real request;
3. writes a temporary local Mock video under the configured data directory;
4. reads and returns its bytes with explicit Mock metadata;
5. removes the temporary file;
6. never prepares references, touches TOS, submits a provider task, or polls the provider.

The result contract reports `executionMode` and `implementation` so both consumers can label the output correctly:

- `video-create` saves the shot artifact as `mock`, changes the stage implementation to `ffmpeg-seedance-mock`, and does not
  claim an AIHubMix provider or model.
- generic creation applies the same provenance and artifact mode.
- real results remain `real` with the existing AIHubMix provenance.

## Error and Restart Behavior

- Local FFmpeg errors propagate as non-provider task errors and remain retryable through the existing job mechanisms.
- Mock jobs do not persist a fake provider task ID or provider submission state.
- Existing recovery behavior for already-submitted real Seedance jobs remains untouched.
- Changing the environment value requires restarting the Worker because configuration is loaded at process startup.

## Validation

- Unit-test strict environment parsing without exposing `.env` contents.
- Test the duration and ratio normalization shared by real and Mock requests.
- Run the FFmpeg helper for real when FFmpeg and FFprobe are installed; probe the output for requested duration, dimensions,
  H.264 video, and AAC audio.
- Test both Seedance consumers for Mock execution mode and absence of provider/TOS work through injected or observable state.
- Run relevant unit tests, TypeScript type checking, and the production build. Do not run E2E unless explicitly requested.

## Acceptance Criteria

1. Local `.env` contains `MOCK_GENERATE_VIDEO_API=true` and `.env.example` documents the flag.
2. Every Seedance model request uses the FFmpeg path while the flag is enabled.
3. Generated output is black, contains one centered random two-digit number, and matches requested duration and ratio.
4. Mock output is explicitly reported as Mock and never presented as a real Seedance result.
5. No TOS or remote provider call occurs in Mock mode.
6. Setting the flag to false restores the existing real Seedance path.
