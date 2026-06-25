# iPad app — Liquid Glass redesign

**Date:** 2026-06-25
**Status:** Approved (design), pending implementation plan
**Scope:** `apps/ipad` renderer only. No transport, IPC, orchestrator, or
desktop-app changes.

## Goal

Make the iPad app (`apps/ipad`) read as a native iPadOS surface rather than a
generic dark dashboard, by adopting a **Liquid Glass** material language —
translucent, blurred, floating chrome over a subtly lit background.

The current UI is flat: opaque panels (`#13141a`) divided by hard 1px borders
(`#2e3038`), a purple accent (`#7c6df0`), 8px square-ish corners, zero
translucency or depth. We replace that with frosted, floating glass panels.

## Constraints (carried from project conventions)

- **No MUI, no CSS framework.** `apps/ipad` is plain React + inline styles by
  deliberate decision. The redesign stays inline-style based; shared values go
  in a small TypeScript token module, not a stylesheet framework.
- **Dark-only.** No light variant (matches the terminal convention).
- **Czech UI, no i18n.** All copy stays Czech; no string infrastructure added.
- **iOS 15 minimum / Capacitor WKWebView.** `backdrop-filter` is supported but
  **requires the `-webkit-` prefix** — every glass surface must set both
  `backdropFilter` and `WebkitBackdropFilter` (React: `WebkitBackdropFilter`).
- **Reality check:** native Liquid Glass (live specular highlights, real-time
  lensing) is a UIKit-only effect we cannot reproduce in a webview. This is a
  CSS approximation: blur + saturation + brightness + hairline highlight
  borders + elevation shadows. It reads most convincingly over the VNC desktop
  and modal scrims; over the opaque terminal it presents as tasteful dark
  translucency. That tradeoff was reviewed and accepted.

## Approved visual direction

Direction **B — "frosted floating"** on a **subtle ambient** background
(chosen over smoked-glass and tinted-brand alternatives, and over flat /
aurora backgrounds).

1. **Frosted floating panels** — the rail and tab strip detach from the screen
   edges (outer gutter, rounded corners, drop shadow + inner top highlight),
   reading as glass cards hovering over the content rather than structural
   bars welded to the edges.
2. **Subtle ambient background** — the app background gains a faint
   brand-coloured glow (purple top-left, cyan top-right, teal bottom-right)
   over near-black, so the glass picks up gentle colour at its edges while the
   terminal text stays readable.
3. **Purple/cyan accents** — active states use a translucent purple wash with
   a glowing accent dot; attention uses a glowing amber dot; the primary CTA is
   a purple gradient with a soft glow.

## Design tokens

All values live in a new module **`apps/ipad/src/theme/glass.ts`**, exported as
constants and small style-builder helpers so every component shares one source
of truth (no copy-pasted magic numbers).

### Ambient background (applied once, behind everything)

```
background:
  radial-gradient(60% 55% at 4% 0%,   rgba(124,109,240,0.34), transparent 60%),
  radial-gradient(70% 65% at 100% 8%, rgba(77,208,225,0.22),  transparent 55%),
  radial-gradient(85% 85% at 88% 100%, rgba(26,188,156,0.26), transparent 55%),
  #0b0c11;
```

This replaces the flat `#0e0f12` on the app root. Tunable: if it reads too
strong on device, lower each alpha toward the subtler `0.18 / 0.15` values —
it is a single knob in `glass.ts`.

### Glass panel (rail, tab strip)

| Property | Value |
|---|---|
| fill | `rgba(48,52,76,0.34)` |
| backdrop-filter | `blur(34px) saturate(1.8) brightness(1.18)` (+ `-webkit-`) |
| border | `1px solid rgba(255,255,255,0.15)` |
| shadow | `0 18px 44px rgba(0,0,0,0.5)` + inset highlight `inset 0 1px 0 rgba(255,255,255,0.30)` |
| radius | rail `20`, tab strip `14`, modal `22`, pill `999` |
| outer gutter | `14px` (rail), `16px` (tab strip) so panels float off the edges |

### Accents

| Token | Value |
|---|---|
| accent (purple) | `#7c6df0` / hover `#a89cf0` / icon-on `#c9bdff` |
| active nav fill | `rgba(168,156,240,0.24)` + ring `0 0 0 1px rgba(168,156,240,0.30)` |
| active tab fill | `rgba(255,255,255,0.20)` |
| active accent dot | `#a89cf0` with `0 0 8px` glow |
| attention dot | `#f5a524` (amber) with `0 0 8px` glow |
| CTA gradient | `linear-gradient(135deg,#8b7cf2,#6d5fe0)` + `0 8px 22px rgba(124,109,240,0.45)` glow |
| logo gradient | unchanged (`conic` cyan/teal/blue) |

### Status colours (banners, pill)

| State | Tint | Accent |
|---|---|---|
| connected | green `rgba(26,90,66,0.34)` / border `rgba(120,230,180,0.32)` | `#34d399` |
| connecting | blue `rgba(20,52,92,0.45)` / border `rgba(96,165,250,0.45)` | `#60a5fa` |
| disconnected | red `rgba(110,24,24,0.40)` / border `rgba(248,113,113,0.45)` | `#f87171` |
| auth-block | amber `rgba(120,82,8,0.40)` / border `rgba(245,165,36,0.45)` | `#f5a524` |

## Layout decision: float in flow, not overlay

The rail and tab strip stay in the **normal flex layout** (they occupy their
box), but gain an **outer margin** so the ambient background shows through the
gutters around them, plus rounding/shadow so they read as floating. They do
**not** absolutely overlay the terminal — terminal text is never hidden under
glass. The visible gutter between chrome and content is the "float."

## Component-by-component changes

All in `apps/ipad/src/`:

1. **`theme/glass.ts`** *(new)* — token constants + helpers:
   `glassPanel()`, `glassFill`, `ambientBackground`, accent/status colours,
   `statusGlass(state)`. Components import from here.
2. **`index.css`** — apply `ambientBackground` to `#root` (keep safe-area
   insets); body fallback colour stays dark to avoid white flash.
3. **`App.tsx`**
   - `Shell` container: ambient background (or transparent over `#root`).
   - `InstancesModule` reconnect bar → **floating glass status banner**
     (blue/red tint) with rounding + gutter, instead of the full-width hard
     bar. A **connected** state shows the green "Připojeno" pill bottom-right.
   - `ConnectionForm` → glass card on the ambient background; inputs and the
     "Připojit" button restyled (glass fields + gradient CTA).
   - Empty state ("Vyberte instanci") restyled for the new palette.
4. **`Rail.tsx`** — glass panel, floating (gutter + radius `20` + shadow +
   inner highlight); active nav = purple wash + ring + `#c9bdff` icon;
   collapsed and expanded widths preserved; collapse chevron restyled.
5. **`TabStrip.tsx`** — glass strip, floating (gutter + radius `14`); tabs
   become rounded pills; active tab = white-wash fill + glowing purple dot;
   **attention replaces the `⚠️` emoji with a glowing amber dot** (cleaner,
   more native); `+` button gets a soft glass chip.
6. **`SpawnModal.tsx`** — modal panel → glass (radius `22`, blur, highlight);
   backdrop scrim → blurred dim (`rgba(6,7,11,0.45)` + `blur(8px)`); project
   rows, kind toggle, restart rows, and footer buttons restyled (glass fields,
   gradient primary CTA, glass secondary). Behaviour unchanged.
7. **`AuthBlockBanner.tsx`** — amber **glass** floating banner (gutter +
   radius) with glowing amber dot; "Otevřít obrazovku Macu" button restyled.
8. **`RemoteMacView.tsx`** — inherits the glass rail/tabs automatically (shared
   chrome). The VNC surface itself is unchanged. **Perf note below.**

## Performance & risk

- **Glass over live content is the expensive case.** `backdrop-filter` blurring
  a continuously-updating surface (xterm output, and especially the noVNC
  canvas in `RemoteMacView`) is GPU-costly on iPad. Mitigation: blur regions
  are small (rail ~46–204px wide, tab strip ~38px tall); keep blur ≤ `34px`;
  if on-device profiling shows jank over VNC, drop `brightness`/`saturate`
  boosts there or reduce blur radius — all single knobs in `glass.ts`.
- **iOS 15 webview:** must ship `-webkit-backdrop-filter`. If a target device
  ever lacks support, the fill alpha (`0.34`) keeps panels legible without
  blur (graceful degradation) — verify the fallback looks acceptable.
- **No behaviour changes.** This is presentation-only; no IPC, state, or
  control-flow edits. Tab selection, spawn/restart, auth-block routing,
  reconnect logic all stay as-is.

## Out of scope

- Light mode. Desktop app restyle. Animation/transition overhaul beyond the
  existing 120–160ms fades. New screens (Dashboard/Billing/Settings stay
  disabled placeholders). Any change to the terminal/VNC rendering internals.

## Verification

`apps/ipad` has no unit-test runner (build = `vite build`); this is a visual
change. Verification is:

1. `npm run build` in `apps/ipad` (or workspace build) — typechecks + bundles
   clean.
2. `cap sync ios` + run on a physical iPad — confirm glass renders (blur +
   ambient), no white flashes, safe-area insets intact, and no scroll/jank
   regressions on the terminal and VNC views.
3. Spot-check each surface against the approved mockups: rail (collapsed +
   expanded), tab strip (active + attention), spawn modal, connection form,
   all four status states.
```
