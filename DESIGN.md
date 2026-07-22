---
version: alpha
name: ElevenLabs-design-analysis
description: A compact AI creation workspace with an editorial off-white canvas, warm near-black ink, restrained atmospheric color, and one Tailwind-governed typography system. Product surfaces default to a compact 14px sans body; headings use the same Chinese-first system stack with controlled size, weight, line height, and tracking. No page may introduce raw CSS typography values outside the Tailwind theme.

colors:
  primary: "#292524"
  primary-active: "#0c0a09"
  ink: "#0c0a09"
  body: "#4e4e4e"
  body-strong: "#292524"
  muted: "#777169"
  muted-soft: "#a8a29e"
  hairline: "#e7e5e4"
  hairline-soft: "#f0efed"
  hairline-strong: "#d6d3d1"
  canvas: "#f5f5f5"
  canvas-soft: "#fafafa"
  canvas-deep: "#0c0a09"
  surface-card: "#ffffff"
  surface-strong: "#f0efed"
  surface-dark: "#0c0a09"
  surface-dark-elevated: "#1c1917"
  on-primary: "#ffffff"
  on-dark: "#ffffff"
  on-dark-soft: "#a8a29e"
  gradient-mint: "#a7e5d3"
  gradient-peach: "#f4c5a8"
  gradient-lavender: "#c8b8e0"
  gradient-sky: "#a8c8e8"
  gradient-rose: "#e8b8c4"
  semantic-error: "#dc2626"
  semantic-success: "#16a34a"

typography:
  font-sans: "'Inter', 'PingFang SC', 'Microsoft YaHei', ui-sans-serif, system-ui, sans-serif"
  font-display: "{typography.font-sans}"
  text-2xs: 10px / 14px
  text-xs: 12px / 16px
  text-sm: 14px / 20px
  text-base: 16px / 24px
  text-lg: 18px / 26px
  text-xl: 20px / 28px
  text-2xl: 24px / 32px
  text-3xl: 30px / 36px
  text-4xl: 36px / 42px
  text-5xl: 48px / 52px
  text-6xl: 64px / 68px
  weights: [300, 400, 500, 600]
  tracking: [tight, normal, wide, wider, widest]

rounded:
  none: 0px
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  xxl: 24px
  pill: 9999px
  full: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  base: 16px
  md: 20px
  lg: 24px
  xl: 32px
  xxl: 48px
  section: 96px

components:
  top-nav:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "font-sans text-sm font-medium"
    height: 64px
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "font-sans text-sm font-medium"
    rounded: "{rounded.pill}"
    padding: 10px 20px
    height: 40px
  button-primary-active:
    backgroundColor: "{colors.primary-active}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.pill}"
  button-outline:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    typography: "font-sans text-sm font-medium"
    rounded: "{rounded.pill}"
    padding: 9px 19px
    height: 40px
  button-tertiary-text:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    typography: "font-sans text-sm font-medium"
  hero-band:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "font-display text-5xl font-light tracking-tight"
    padding: 96px
  gradient-orb-card:
    backgroundColor: "{colors.canvas-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xxl}"
    padding: 32px
  feature-card:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    typography: "font-sans text-xl font-medium"
    rounded: "{rounded.xl}"
    padding: 24px
  product-card-stack:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    typography: "font-sans text-sm font-normal"
    rounded: "{rounded.xl}"
    padding: 0
  voice-row:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    typography: "font-sans text-sm font-normal"
    padding: 12px 0
  voice-icon-circular:
    backgroundColor: "{colors.surface-strong}"
    rounded: "{rounded.full}"
    size: 32px
  pricing-tier-card:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    typography: "font-sans text-sm font-normal"
    rounded: "{rounded.xl}"
    padding: 32px
  pricing-tier-featured:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.on-dark}"
    typography: "font-sans text-sm font-normal"
    rounded: "{rounded.xl}"
    padding: 32px
  text-input:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    typography: "font-sans text-sm font-normal"
    rounded: "{rounded.md}"
    padding: 12px 16px
    height: 44px
  badge-pill:
    backgroundColor: "{colors.surface-strong}"
    textColor: "{colors.ink}"
    typography: "font-sans text-xs font-semibold tracking-widest uppercase"
    rounded: "{rounded.pill}"
    padding: 4px 10px
  cta-band:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "font-display text-3xl font-light tracking-tight"
    padding: 96px
  testimonial-card:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.body}"
    typography: "font-sans text-sm font-normal"
    rounded: "{rounded.xl}"
    padding: 32px
  audio-waveform-card:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: 24px
  footer:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.body}"
    typography: "font-sans text-sm font-normal"
    padding: 64px 48px
  footer-link:
    backgroundColor: transparent
    textColor: "{colors.body}"
    typography: "font-sans text-sm font-normal"
---

## Overview

ElevenLabs reads like a quietly editorial print magazine that happens to be a voice-AI product. The base canvas is off-white `{colors.canvas}` (#f5f5f5) holding warm near-black ink `{colors.ink}` (#0c0a09). The brand voltage is **photographic, not chromatic**: soft pastel atmospheric gradient orbs (mint, peach, lavender, sky, rose) drift through the page as the only "color" moments. There is no neon accent, no saturated CTA color, no dark-canvas dev-tools atmosphere.

Typography uses one Tailwind-governed, Chinese-first sans stack across product and marketing surfaces. Product body copy defaults to a compact 14px; hierarchy comes from the approved Tailwind size, weight, line-height, and tracking utilities rather than page-specific CSS values.

CTAs are subtle: a near-black ink pill (`{component.button-primary}`) is the primary, a transparent outline (`{component.button-outline}`) is the secondary. The brand trusts atmospheric photography and modest type weights to carry brand work.

**Key Characteristics:**
- Off-white canvas, warm near-black ink. No saturated CTA color.
- Single primary action: ink pill at `{rounded.pill}`. Atmospheric gradients carry visual brand voltage.
- Product UI defaults to `font-sans text-sm`; regular page titles remain between `text-xl` and `text-3xl`.
- All typography values come from `web/styles/tailwind.css`; business CSS contains no raw typography declarations.
- Pastel gradient orbs (5 tokens: mint, peach, lavender, sky, rose) used as atmospheric brand decoration only.
- Soft pill geometry (`{rounded.pill}` for CTAs, `{rounded.xl}` for cards).
- 96px section rhythm.

## Colors

### Brand & Accent
- **Ink Primary** (`{colors.primary}` — #292524): The primary action color — warm near-black pill. Used scarcely.
- **Ink Primary Active** (`{colors.primary-active}` — #0c0a09): Press state.

### Surface
- **Canvas** (`{colors.canvas}` — #f5f5f5): Off-white page floor.
- **Canvas Soft** (`{colors.canvas-soft}` — #fafafa): Lighter band for subtle alternating sections.
- **Canvas Deep** (`{colors.canvas-deep}` — #0c0a09): Same as ink — used for the rare dark-mode hero (Agents page).
- **Surface Card** (`{colors.surface-card}` — #ffffff): Pure white card.
- **Surface Strong** (`{colors.surface-strong}` — #f0efed): Badges, voice-icon plates.
- **Surface Dark** (`{colors.surface-dark}` — #0c0a09): Dark hero/CTA band canvas.
- **Surface Dark Elevated** (`{colors.surface-dark-elevated}` — #1c1917): Cards on dark canvas.

### Hairlines
- **Hairline** (`{colors.hairline}` — #e7e5e4): Default 1px divider.
- **Hairline Soft** (`{colors.hairline-soft}` — #f0efed): Lighter divider.
- **Hairline Strong** (`{colors.hairline-strong}` — #d6d3d1): Stronger panel outline.

### Text
- **Ink** (`{colors.ink}` — #0c0a09): Display, primary text.
- **Body** (`{colors.body}` — #4e4e4e): Default running-text.
- **Body Strong** (`{colors.body-strong}` — #292524): Same as primary — emphasis.
- **Muted** (`{colors.muted}` — #777169): Sub-titles.
- **Muted Soft** (`{colors.muted-soft}` — #a8a29e): Disabled text.
- **On Primary** (`{colors.on-primary}` — #ffffff): White text on ink pill.
- **On Dark** (`{colors.on-dark}` — #ffffff): White text on dark hero.
- **On Dark Soft** (`{colors.on-dark-soft}` — #a8a29e): Muted off-white on dark.

### Atmospheric Gradient Stops (signature)
- **Gradient Mint** (`{colors.gradient-mint}` — #a7e5d3): Mint green orb.
- **Gradient Peach** (`{colors.gradient-peach}` — #f4c5a8): Peach orb.
- **Gradient Lavender** (`{colors.gradient-lavender}` — #c8b8e0): Lavender orb.
- **Gradient Sky** (`{colors.gradient-sky}` — #a8c8e8): Sky-blue orb.
- **Gradient Rose** (`{colors.gradient-rose}` — #e8b8c4): Rose orb.

These appear ONLY as soft radial-gradient atmospheric orbs inside `{component.gradient-orb-card}` and as background atmospheric blooms behind hero copy. Never as button fills, never as text colors.

### Semantic
- **Success** (`{colors.semantic-success}` — #16a34a): Confirmation.
- **Error** (`{colors.semantic-error}` — #dc2626): Validation errors.

## Typography

### Single Source of Truth

`web/styles/tailwind.css` is the only runtime source for font families and the type scale. `font-sans` uses `Inter`, `PingFang SC`, `Microsoft YaHei`, `ui-sans-serif`, `system-ui`, then `sans-serif`. The repository does not currently ship Inter or Waldenburg font files, so installed system fonts provide the actual rendering. `font-display` intentionally aliases `font-sans` until an approved, bundled display font is available.

TSX uses Tailwind classes directly. Legacy selector-based CSS uses `@apply` after referencing the shared Tailwind theme. Raw `font-family`, `font-size`, `font-weight`, `line-height`, `letter-spacing`, inline typography styles, and arbitrary typography utilities are prohibited. The only base-layer exception is `font: inherit` on native form controls.

### Hierarchy

| Tailwind Token | Size / Line Height | Use |
|---|---|---|
| `text-2xs` | 10px / 14px | Dense metadata and compact status only |
| `text-xs` | 12px / 16px | Helper copy, labels, badges, timestamps |
| `text-sm` | 14px / 20px | Default product body, buttons, forms, tables, navigation |
| `text-base` | 16px / 24px | Emphasized body and relaxed reading content |
| `text-lg` | 18px / 26px | Small section and dialog titles |
| `text-xl` | 20px / 28px | Component and standard dialog titles |
| `text-2xl` | 24px / 32px | Product page titles |
| `text-3xl` | 30px / 36px | Large product page titles |
| `text-4xl` | 36px / 42px | Compact marketing display titles |
| `text-5xl` | 48px / 52px | Marketing hero titles |
| `text-6xl` | 64px / 68px | Homepage hero only; forbidden in product workspaces |

### Principles
- **Compact product default.** Product pages inherit `font-sans text-sm`; use larger body text only when reading comfort materially benefits.
- **Limited weights.** Use only `font-light`, `font-normal`, `font-medium`, and `font-semibold`. `font-light` is display-only; normal text never drops below 400.
- **Controlled rhythm.** Prefer the line height bundled with each `text-*` Token. Overrides are limited to Tailwind `leading-none`, `leading-tight`, `leading-snug`, `leading-normal`, `leading-relaxed`, and `leading-loose`.
- **Controlled tracking.** Use only `tracking-tight`, `tracking-normal`, `tracking-wide`, `tracking-wider`, and `tracking-widest`. Running body copy normally uses default tracking.
- **No arbitrary values.** Do not use `text-[…]`, `font-[…]`, `leading-[…]`, `tracking-[…]`, or inline typography styles.
- **No fake fonts.** Do not reference a font family unless its files are bundled or it exists in the approved fallback stack.

## Layout

### Spacing System
- **Base unit:** 4px.
- **Tokens:** `{spacing.xxs}` 4px · `{spacing.xs}` 8px · `{spacing.sm}` 12px · `{spacing.base}` 16px · `{spacing.md}` 20px · `{spacing.lg}` 24px · `{spacing.xl}` 32px · `{spacing.xxl}` 48px · `{spacing.section}` 96px.
- **Section padding:** 96px.

### Grid & Container
- Max content width: ~1200px.
- Editorial body: 12-column grid.
- Feature card grids: 2-up at desktop for hero splits, 3-up for benefit grids.
- Footer: 5-column at desktop.

### Whitespace Philosophy
Generous editorial pacing — print-magazine feel. 96px between bands; cards inside bands sit close (16-24px gap). The atmospheric gradient orbs occupy generous breathing space without competing with copy.

## Elevation & Depth

The system uses **hairline + soft drop**. Cards float above the off-white canvas via 1px hairlines and a single subtle shadow tier. Atmospheric depth comes from gradient orbs.

| Level | Treatment | Use |
|---|---|---|
| Flat (canvas) | `{colors.canvas}` (#f5f5f5) | Body bands, footer |
| Card | `{colors.surface-card}` (#ffffff) | Content cards |
| Hairline border | 1px `{colors.hairline}` | Card outlines |
| Soft drop | `0 4px 16px rgba(0, 0, 0, 0.04)` | Hovered cards (single shadow tier) |
| Gradient orb | Radial gradient with one of `{colors.gradient-*}` | Atmospheric depth — never a card surface |

### Decorative Depth
- **Pastel gradient orbs** are the brand's strongest atmospheric pattern. Soft radial blooms in mint, peach, lavender, sky, or rose drift through hero bands and feature sections without containing any content — they are pure atmosphere.

## Shapes

### Border Radius Scale

| Token | Value | Use |
|---|---|---|
| `{rounded.none}` | 0px | Reserved |
| `{rounded.xs}` | 4px | Inline tags |
| `{rounded.sm}` | 6px | Compact rows |
| `{rounded.md}` | 8px | Form inputs |
| `{rounded.lg}` | 12px | Compact cards |
| `{rounded.xl}` | 16px | Feature cards, pricing tiers |
| `{rounded.xxl}` | 24px | Gradient orb cards (extra-soft) |
| `{rounded.pill}` | 9999px | All CTA buttons, badges |
| `{rounded.full}` | 9999px | Voice icon circles, avatars |

## Components

### Top Navigation

**`top-nav`** — Background `{colors.canvas}`, text `{colors.ink}`, height 64px. Layout: ElevenLabs wordmark left, primary horizontal menu (Creative / Agents / Video / Pricing / Enterprise / Docs), Sign In + "Try free" primary CTA right.

### Buttons

**`button-primary`** — Near-black ink pill. Background `{colors.primary}`, text `{colors.on-primary}`, type `font-sans text-sm font-medium` (14px / 500), padding 10px × 20px, height 40px, rounded `{rounded.pill}`.

**`button-primary-active`** — Press state. Background `{colors.primary-active}`.

**`button-outline`** — Transparent pill with 1px ink border. Background transparent, text `{colors.ink}`, 1px `{colors.hairline-strong}` border.

**`button-tertiary-text`** — Inline ink text link.

### Hero & Atmospheric

**`hero-band`** — Background `{colors.canvas}`, full-width display headline in `font-display text-5xl font-light tracking-tight` (48px / 300), subhead in `font-sans text-sm font-normal`, two CTAs, and an atmospheric gradient orb behind the centered headline.

**`gradient-orb-card`** — A large card with a soft radial-gradient orb behind centered display copy. Background `{colors.canvas-soft}`, rounded `{rounded.xxl}` (24px), padding 32px. Each variant uses one of the five gradient tokens (`gradient-mint`, `gradient-peach`, `gradient-lavender`, `gradient-sky`, `gradient-rose`).

**`audio-waveform-card`** — A waveform visualization card. Background `{colors.surface-card}`, rounded `{rounded.xl}`, padding 24px. Holds a play button + waveform glyph + voice metadata.

### Cards

**`feature-card`** — 2-up or 3-up grids. Background `{colors.surface-card}`, text `{colors.ink}`, rounded `{rounded.xl}`, padding 24px, 1px hairline border.

**`product-card-stack`** — Stacked product preview cards. Background `{colors.surface-card}`, rounded `{rounded.xl}`, no padding (children fill the card edge-to-edge).

**`testimonial-card`** — Quote card. Background `{colors.surface-card}`, text `{colors.body}`, rounded `{rounded.xl}`, padding 32px.

**`data-table`** — One shared shadcn-style table appearance across the system. Use a 40px sticky header, 56px rows, compact cell padding, and subtle horizontal row dividers. The component has no outer card border, radius, shadow, owned background, page-specific visual variant, or horizontal scrollbar. Columns share the available width proportionally; long content stays on one line and truncates. Pages control layout and background only; compose filters and actions with shadcn `h-8` controls and Tailwind spacing utilities.

**`asset-page`** — Shared compact shell for materials, portraits, products, and voices. Use a white `p-3` page, one compact search/action toolbar, an independently scrolling content region, and a small result count. Materials retain a two-column folder-and-table layout; portraits and products retain preview grids; voices use horizontal `voice-row` items. Do not add page cards, subtitles, descriptions, or per-page toolbar styling.

### Voice Library

**`voice-row`** — Horizontal row in voice list. Background transparent, 1px hairline divider. Layout: 32px circular voice icon (`{component.voice-icon-circular}`) left, voice name + accent stack, optional preview button right.

**`voice-icon-circular`** — Background `{colors.surface-strong}`, rounded `{rounded.full}`, 32px diameter. Holds initials or voice glyph.

### Pricing

**`pricing-tier-card`** — Background `{colors.surface-card}`, rounded `{rounded.xl}`, padding 32px, 1px hairline border.

**`pricing-tier-featured`** — Featured tier inverts. Background `{colors.surface-dark}`, text `{colors.on-dark}`. Same shape, dark inversion.

### Forms & Tags

**`text-input`** — Background `{colors.surface-card}`, text `{colors.ink}`, type `font-sans text-sm font-normal`, rounded `{rounded.md}` (8px), padding 12px × 16px, height 44px, 1px `{colors.hairline-strong}` border. On focus, border thickens to 2px ink.

**`native-select`** — Select width follows its selected content instead of filling the form control column. Different Select controls may have different natural widths; preserve compact arrow padding, cap width at the parent, and allow secondary actions beside the control when space permits. Do not add empty internal width merely to align unrelated controls.

**`file-upload`** — Compact shadcn-style drop container using the same border, radius, focus ring, label, and helper-text semantics as other form controls. The default state supports click and drag selection; active drag uses a restrained primary tint. Upload progress, errors, retry actions, and type-aware media previews stay inside the same container. Avoid oversized icons and tall decorative drop zones; the idle container should remain close to 112px high.

**`creator-modal`** — Shared compact task-creation modal for every `ModulePage`. Use one `max-w-lg` shell, 52px header/footer, a single `text-base font-medium` title, `text-sm` body, `text-xs` labels/help, and shadcn small controls. Do not place a subtitle or description below the title. Desktop form rows use a 96px label column and flexible control column; small screens collapse to one column. Do not introduce per-module modal sizing, typography, footer, or field spacing.

**`badge-pill`** — Background `{colors.surface-strong}`, text `{colors.ink}`, type `font-sans text-xs font-semibold tracking-widest uppercase`, rounded `{rounded.pill}`, padding 4px × 10px.

### CTA / Footer

**`cta-band`** — Pre-footer. Background `{colors.canvas}`, centered display headline in `font-display text-3xl font-light tracking-tight`, single ink pill CTA. 96px padding.

**`footer`** — Closing footer. Background `{colors.canvas}`, text `{colors.body}`. 5-column link list. 64×48px padding.

**`footer-link`** — Background transparent, text `{colors.body}`, type `font-sans text-sm font-normal`.

## Do's and Don'ts

### Do
- Reserve `{colors.primary}` (ink pill) for primary CTAs.
- Use `font-sans text-sm` as the default product typography.
- Use only the Tailwind font, text, leading, tracking, and weight Tokens documented above.
- Keep regular product page titles at `text-xl`–`text-3xl`; reserve larger sizes for marketing surfaces.
- Use atmospheric gradient orbs (mint/peach/lavender/sky/rose) as decoration only.
- Use the pill shape for every CTA and badge.

### Don't
- Don't introduce a saturated brand action color. Ink pill is the only CTA color.
- Don't add subtitles, descriptions, taglines, or explanatory copy below titles unless the user explicitly requests them.
- Don't add raw CSS typography declarations, inline typography styles, or arbitrary typography utilities.
- Don't use `font-bold` or `font-extrabold`; `font-semibold` is the maximum approved UI weight.
- Don't use gradient orbs as button fills, text colors, or component backgrounds. They are pure atmosphere.
- Don't use sharp `{rounded.none}` (0px) on CTAs. Pill geometry is the brand button.
- Don't use `font-light` for body text; body stays at 400 or 500 for legibility.
- Don't extract a CTA color from a third-party widget (cookie consent, OneTrust). The brand's CTA color is what appears on actual product CTAs.

## Responsive Behavior

### Breakpoints

| Name | Width | Key Changes |
|---|---|---|
| Mobile | < 640px | Marketing hero h1 48→36px; feature cards 1-up; nav hamburger; gradient orbs shrink. |
| Tablet | 640–1024px | Hero h1 48px; feature cards 2-up. |
| Desktop | 1024–1280px | Full marketing hero h1 48px; feature cards 3-up. |
| Wide | > 1280px | Content caps at 1200px. |

### Touch Targets
- Primary pill at 40px height — at WCAG AA, padded for AAA.
- Voice icon circles 32px — padded row creates effective 48px tap zone.

### Collapsing Strategy
- Top nav switches to hamburger below 768px.
- Feature grid: 3-up → 2-up → 1-up.
- Gradient orbs reduce diameter at every breakpoint but never disappear.

## Iteration Guide

1. Focus on a single component at a time.
2. CTAs default to `{rounded.pill}`. Cards use `{rounded.xl}` (16px).
3. Variants live as separate entries.
4. Use `{token.refs}` everywhere — never inline hex.
5. Hover state never documented.
6. Run `bun run check:typography`; Tailwind theme utilities are mandatory for all text styling.
7. Gradient orbs scoped to atmospheric decoration.

## Known Gaps

- Inter is preferred but not bundled; actual rendering falls through to the approved Chinese-first system stack.
- Animation timings (orb drift, waveform pulse, hero entrance) out of scope.
- In-product surfaces (voice library editor, agent playground) only partially captured via marketing mockups.
- Form validation states beyond focus not visible on captured surfaces.
