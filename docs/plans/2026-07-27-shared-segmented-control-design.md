# Shared Segmented Control Design

## Goal

Make the video-remix mode selector match the ad-script `营销场景 / 投放场景` control exactly while removing duplicated segmented-control markup.

## Shared Component

Add `SegmentedControl` under `web/components/ui/`. It accepts an accessible label, a typed current value, an option list, and an `onValueChange` callback.

The component owns the established appearance from the ad-script page:

- restrained strong-surface track with 8px radius and 4px padding;
- `ghost + sm` shadcn Buttons;
- selected segment uses the normal surface, a subtle shadow, and the same hover surface;
- compact semantic typography inherited from the shared Button.

## Page Integration

The ad-script scene category migrates from inline markup to `SegmentedControl` and keeps its existing `marketing / placement` state transitions, scene reset, and labels.

The video-remix selector replaces the Radix Switch with `SegmentedControl` options `含商品模式 / 纯口播模式`. The values remain `product / talking`; persistence and API requests do not change.

## Verification

- Add a component render and interaction test.
- Update ad-script and video-remix regression tests to prove both pages use the shared component and preserve state transitions.
- Run targeted tests, TypeScript typecheck, production build, and the full unit suite.
- Do not run E2E unless explicitly requested.
