# Shared Dashed Picker And Remix Mode Design

## Goal

Restore the intended compact controls in the video-remix configuration sidebar. Replace the two-button mode selector with the shared Switch and make every resource-picker trigger use the same dashed selection pattern as the one-click video product-image picker.

## Scope

- Replace the `含商品模式` / `纯口播模式` button pair with one labeled shadcn Switch.
- Preserve the existing `product` and `talking` state values and request contract.
- Unify the video-remix product, portrait, and voice picker triggers as dashed selection tiles.
- Extract a shared domain component and reuse it in the one-click video product-image add action.
- Preserve existing resource previews, removal actions, dialogs, validation, and data ownership.

## Shared Component

Add `DashedPickerTile` under `web/components/domain/`. It composes the shared shadcn Button and owns the common dashed border, compact radius, hover/focus behavior, icon alignment, and semantic typography.

The component accepts normal Button props plus compact presentation inputs for an icon, title, description, and optional preview. It remains a presentation and trigger component only. Resource queries, dialog state, selected values, and mutations stay in the feature pages.

The default tile matches the one-click product-image add tile: 64px wide, 80px high, vertically centered. A full-width presentation supports the video-remix sidebar without duplicating visual rules. Both presentations retain the same dashed interaction language.

## Video Remix Behavior

The mode row renders `含商品模式` with the shared Switch. Checked maps to `product`; unchecked maps to `talking`. No new mode or explanatory copy is introduced.

Product, portrait, and voice fields retain their labels and current dialogs. Their popup triggers use `DashedPickerTile`:

- Product shows the current product thumbnail and name when selected, otherwise an add affordance.
- Portrait preserves the selected portrait cards and removal controls, with one dashed add/change trigger.
- Voice shows the current voice name and description when selected, otherwise a selection affordance.

## One-click Video Reuse

The existing dashed product-image add Button in `ProductImages` is replaced by `DashedPickerTile`. Selected image thumbnails remain unchanged because they are previews and removal controls, not picker triggers.

## Styling

The shared component uses Tailwind tokens and semantic typography. Video-remix CSS keeps layout-only rules and removes the superseded mode-tab and resource-trigger visual overrides. Business CSS must not restyle the shared Button's border, radius, typography, hover, focus, or disabled states.

Update `DESIGN.md` with the reusable dashed picker contract because this is a cross-page visual pattern.

## Verification

- Component test covers default and full-width presentations and click behavior.
- Video-remix regression test proves the Switch mapping and all three shared picker triggers.
- One-click video regression test proves it reuses the shared component.
- Run targeted unit tests, `bun run typecheck`, and `bun run build`.
- Do not run E2E unless explicitly requested.
