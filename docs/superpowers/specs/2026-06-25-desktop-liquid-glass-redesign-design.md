# Desktop app — Liquid Glass redesign (native macOS vibrancy)

**Date:** 2026-06-25
**Status:** Approved (design), pending implementation plan
**Scope:** `apps/desktop` renderer + `electron/` window/theme bridge. No
orchestrator, transport, or iPad-app changes. Companion to the iPad redesign
(`2026-06-25-ipad-liquid-glass-redesign-design.md`).

## Goal

Make the macOS desktop app match **today's macOS Liquid Glass** look, using
**real OS vibrancy** (not the CSS-only approximation the iPad webview is limited
to). The desktop wallpaper blurs through the window, sidebar, and chrome like a
native app; app content layers frosted glass on top.

Approved visual direction: **full glass** — the content canvas and cards are
translucent/frosted too (not just the chrome), in **both dark and light**
modes, validated against the data-dense TimeTracker module.

## Why native vibrancy (key difference from iPad)

Electron on macOS exposes `BrowserWindow({ vibrancy })`, which renders a real
`NSVisualEffectView` behind the web contents — GPU-accelerated by the OS,
auto-adapting to wallpaper and appearance. This is unavailable to the iPad
Capacitor webview, which is why that app uses a CSS ambient-gradient fake. On
desktop we get the genuine effect for the window base, and use CSS
`backdrop-filter` only for inner layering (cards, drawers, dialogs floating over
app content).

## Current state (audit summary)

- **Two MUI themes** in `apps/desktop/src/theme.ts`: `darkTheme` (default) +
  `lightTheme`. Purple `#7c5cff`/`#6e54e0`, cyan `#22d3ee`/`#0ea5b7`,
  `borderRadius: 12`, Inter. Mode persisted in `localStorage`
  `'watchtower:theme-mode'` (`useThemeMode.ts`), mirrored to
  `<html data-theme>`.
- **Window** (`electron/window.ts`): `titleBarStyle: 'hiddenInset'`,
  `trafficLightPosition {x:12,y:14}`, **solid** `backgroundColor: '#0e0f12'`,
  **no** `vibrancy` / `visualEffectState` / `transparent`. `nativeTheme` not
  used anywhere.
- **Splash** (`apps/desktop/index.html`): `body { background: var(--wt-splash-bg) }`
  — solid `#0a0b0f` (dark) / `#f7f8fa` (light), set before React mounts.
- **Chrome**: global `TabStrip.tsx` (also the `-webkit-app-region: drag`
  region) + collapsible `ModuleRail.tsx`. A frosted `MuiAppBar` override exists
  in the theme but is **dead code** (TabStrip uses `Box`, not `AppBar`).
- **Surfaces**: cards = `Paper variant="outlined"`; dialogs = MUI `Dialog`
  (no override); drawers = MUI `Drawer` (`MuiDrawer.paper` override, solid
  `#0d0f15`/`#fff`); charts = Recharts via `useChartColors`/`chartTheme.ts`;
  tables = `Box`-grid rows / `List`. Terminal pane (`ColumnSlot.tsx`,
  `Terminal.tsx`) is **hardcoded opaque `#0e0f12`** and never themed. The
  split `PanelResizeHandle` uses a raw `rgba(255,255,255,0.08)` style.

## Architecture of the change

Three layers, in dependency order:

1. **Native window vibrancy** (`electron/`) — turn the window into a vibrancy
   surface and keep its material in sync with the app theme.
2. **Theme/token layer** (`apps/desktop/src/theme.ts` + new
   `apps/desktop/src/theme/glass.ts` + `index.html`) — move background tokens
   to alpha so vibrancy shows through, add glass component overrides, expose a
   shared `glassSurface()` helper for inline-`sx` surfaces.
3. **Per-surface restyle** — chrome, shared surfaces, then each module.

### 1. Native window vibrancy (`electron/window.ts`)

- Add `vibrancy: 'under-window'` and `visualEffectState: 'active'` (stays
  vibrant when the window is unfocused).
- Replace the opaque `backgroundColor: '#0e0f12'` with a fully transparent
  `backgroundColor: '#00000000'` so web contents composite over the vibrancy
  view. (Do **not** also set `transparent: true` — `vibrancy` already provides
  the translucent base; combining them on macOS causes shadow/corner glitches.)
- Keep `titleBarStyle: 'hiddenInset'` + traffic-light position. macOS gives
  vibrancy windows rounded corners + the standard shadow automatically.
- **Theme ↔ material sync:** add a `nativeTheme.themeSource` bridge. When the
  renderer toggles theme (`useThemeMode`), send an IPC (electron-only kind,
  e.g. `appearance:set` → `ELECTRON_ONLY_KINDS`) that sets
  `nativeTheme.themeSource = 'dark' | 'light'`. This makes the OS vibrancy
  material match the in-app palette (otherwise a light app over a dark vibrancy
  material looks wrong). Set the initial value at window create time from the
  persisted mode (read the same `watchtower:theme-mode` the splash uses, or
  default dark).

### 2. Theme/token layer

- **`index.html` splash:** `body` background → `transparent`; the splash
  spinner sits on a translucent scrim (`rgba` over vibrancy) so there's no
  solid flash hiding the vibrancy on launch. Keep the early `data-theme` set.
- **`theme.ts` palette → alpha.** So vibrancy shows through:
  - dark: `background.default` ≈ `rgba(18,20,28,0.32)` (content canvas),
    `background.paper` ≈ `rgba(60,64,86,0.34)` (cards/frosted).
  - light: `background.default` ≈ `rgba(244,245,250,0.40)`,
    `background.paper` ≈ `rgba(255,255,255,0.50)`.
  - Keep text/accent/divider as today but verify contrast over vibrancy
    (bump `text.secondary` if it washes out, esp. light mode).
- **New `apps/desktop/src/theme/glass.ts`** — single source of truth for glass
  values + a `glassSurface(theme, {elevation})` helper returning an `sx`/CSS
  object: frosted fill, `backdropFilter` + `WebkitBackdropFilter`
  (`blur(22-40px) saturate(1.5)`), hairline border, inset top highlight. Used
  by both theme overrides and inline-`sx` components so nothing hardcodes blur.
- **Component overrides** (in `theme.ts`, per mode):
  - `MuiPaper` (and the `outlined` variant) → frosted glass via `glassSurface`.
  - `MuiDrawer.paper` → frosted glass (replace the solid `#0d0f15`/`#fff`).
  - **New** `MuiDialog`/`MuiPopover`/`MuiMenu` paper → frosted glass **but**
    `MuiTooltip` and Recharts tooltips stay **solid** (legibility — see risks).
  - `MuiAppBar` override already frosted; either wire `TabStrip` to it or
    fold its values into the TabStrip restyle (the override becomes live, not
    dead, code).

### 3. Per-surface restyle — phased

Glass everywhere except the terminal. Phasing keeps each PR reviewable:

- **Phase A — Foundation** *(blocks all others):* window vibrancy + theme-sync
  IPC, palette→alpha, `glass.ts` helper, splash transparency, component
  overrides. App launches with vibrancy visible in both modes.
- **Phase B — Chrome:** `TabStrip.tsx` (glass top bar, keep drag region),
  `ModuleRail.tsx` (vibrant sidebar, active-item purple wash + ring).
- **Phase C — Shared surfaces:** dialogs, drawers, cards/Paper, menus/popovers
  (frosted) and tooltips (solid); theme the `PanelResizeHandle` hairline.
- **Phase D — Dashboard:** `ModuleDashboard` cards (`KpiTiles`,
  `TokenUsageCard`, `SessionsCard`, `SprintStrip`, `ActiveContractsCard`,
  `Heatmap`/`TopProjectsCard`) → frosted glass.
- **Phase E — TimeTracker:** projects master-detail, worklog list, task grid,
  board, reports/chart cards (`ChartCard`), and all TT drawers; confirm chart
  tooltips render solid via `chartTheme.tooltipBg`.
- **Phase F — Settings:** general form, hooks accordions, skills/agents/mcp/
  slack list+detail panes — sit them on frosted cards instead of bare
  `background.default`.
- **Phase G — Instances chrome + finish:** `SessionTabBar` glass; **terminal
  panes stay opaque** (`ColumnSlot`/`Terminal` keep `#0e0f12`) so wallpaper
  never bleeds into terminal output; final dark/light pass + perf check.

## Terminal pane: deliberately opaque

The xterm pane is the one surface that stays solid dark in both modes
(`ColumnSlot.tsx`, `Terminal.tsx` unchanged). Vibrancy behind a constantly
-repainting terminal would be unreadable and costly; an opaque terminal on a
glass shell is also the conventional, expected look. The pane reads as a solid
"screen" inset into the glass chrome.

## Risks & mitigations

- **Legibility on dense data.** Worklog tables, task grid, settings forms.
  Mitigation: cards at ~0.34–0.50 alpha (not lower), strong text tokens, and
  **solid tooltips/menus**. If a surface still reads poorly, raise that card's
  opacity — single knob in `glass.ts`. Validated in the approved mockup.
- **Vibrancy/appearance mismatch.** Without the `nativeTheme.themeSource`
  sync, toggling the in-app theme leaves the OS material wrong. The Phase-A
  IPC bridge is mandatory, not optional.
- **Launch flash.** A solid splash body hides vibrancy on first paint —
  hence the transparent-body splash change in Phase A.
- **Charts over glass.** `chartTheme.ts` `tooltipBg` must stay solid;
  `Heatmap` empty cells use `alpha(text.primary, .06)` — verify they don't
  vanish into vibrancy (bump empty-cell alpha if needed).
- **Transparent-window quirks.** Drag region (`-webkit-app-region`) must keep
  working on the now-transparent window; verify traffic-light hit area and
  window resize. Test `visualEffectState: 'active'` so an unfocused window
  doesn't grey out.
- **Performance.** Many simultaneous `backdrop-filter` layers can tax the GPU.
  Native vibrancy is cheap (OS-composited); the cost is CSS-blurred inner
  cards. Keep inner blur ≤ `22px`, avoid nesting blurred surfaces inside
  blurred surfaces where possible.

## Out of scope

- iPad app (separate spec). Orchestrator/transport/DB. New screens or feature
  work. Windows/Linux vibrancy (macOS-only app). Changing chart *types* or
  table data models. Terminal rendering internals.

## Verification

`apps/desktop` has a vitest suite (project rule: 219+ tests) — mostly logic;
this is a presentation change, so:

1. `npm test` (full suite, from repo root) stays green.
2. `npm run typecheck` clean (includes `electron`, `apps/desktop`).
3. `npm run build` clean.
4. Run on macOS (`npm run dev`): vibrancy visible in **both** modes; toggling
   theme flips the OS material; no launch flash; terminal panes opaque; drag
   region + traffic lights work; no perceptible jank scrolling TimeTracker /
   resizing splits.
5. Spot-check every surface against the approved mockups in dark + light.
```
