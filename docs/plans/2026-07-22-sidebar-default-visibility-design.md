# Sidebar default visibility design

## Goal

Hide menu items whose `menuFeatures` value is `false` by default while still allowing a user to show them from the
sidebar menu editor. Visibility overrides must not change feature availability or route gating.

## Preference model

Extend sidebar preferences with a `shown` list alongside the existing `hidden` list. `shown` records an explicit user
override for a feature-disabled item. `hidden` continues to record explicit user hiding for any item.

An item is effectively hidden when it is explicitly in `hidden`, or when its feature is unavailable and it is not in
`shown`. When availability later changes to `true`, an untouched item appears automatically; an explicitly hidden item
stays hidden.

Existing saved order and hidden entries remain valid. Old preferences without `shown` normalize to an empty list, so
feature-disabled items adopt the new hidden default.

## Interaction

Normal sidebar mode omits effectively hidden items. Menu-editing mode lists every item and marks effectively hidden
items with the existing hidden treatment. The eye action writes an explicit visibility choice: showing removes the ID
from `hidden` and adds it to `shown`; hiding removes it from `shown` and adds it to `hidden`.

Showing a feature-disabled item renders the existing `Coming Soon` control. It does not make the route accessible or
change `menuFeatures`.

Resetting the menu clears explicit visibility overrides and restores config-derived defaults.

## Verification

Add unit coverage for default-hidden items, explicit show/hide behavior, old preference normalization, config changes,
and reset behavior. Run type checking, production build, and focused sidebar tests.
