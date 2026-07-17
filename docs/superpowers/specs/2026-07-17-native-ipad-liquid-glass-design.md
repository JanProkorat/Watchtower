# Native iPad — Liquid Glass Design

**Date:** 2026-07-17
**Status:** Approved
**Context:** Follow-up to the native iPad SwiftUI rewrite (epic #203). Phases 1–2 shipped functional but flat; this pass brings the app's visual design in line with the Capacitor iPad app's aesthetic, using Apple's **native Liquid Glass** (iOS 26).

## 1. Goal

Make `apps/ipad-native` look like a deliberate, on-brand iPad app: the ocean-blue palette and a "liquid glass" surface treatment, matching the spirit of the Capacitor `apps/ipad` app. Delivered as a dedicated design pass over the existing (functional) Phase 1–2 views — no behavior changes.

## 2. Locked decisions (from brainstorming)

- **Native Liquid Glass, not a CSS-style approximation.** Use Apple's iOS 26 `glassEffect`/`GlassEffectContainer`/glass button styles. → **Bump the `apps/ipad-native` deployment target from iOS 17 to iOS 26.**
- **Glass on the floating/functional layer only** (Apple HIG). Rail, tab strip, status pills, floating buttons, sheets/toolbars get glass; **content cards and form sections stay on solid surfaces**; the terminal body stays opaque. (Decided against glass-everywhere after an on-device prototype comparison.)
- **The color palette already matches** — `Palette.swift` mirrors the React ocean-blue tokens. This pass only *adds* the few missing tokens; it does not restyle colors.
- **Ambient ocean background** behind everything so the glass has something to refract.
- **Sequencing:** Phase 2 (#221) is already merged; this is its own branch → spec → plan → PR.

## 3. Constraints

- **Deployment target:** `apps/ipad-native` → iOS 26.0. The **`WatchtowerCore` SPM package stays iOS 17** (the iPhone app links it and must not bump). Therefore **all `glassEffect`/glass-API usage lives in the app target only** — never in the SPM package. No `@available` guards needed (the whole app target is iOS 26).
- **Device requirement:** the app will no longer install on iPad below iOS 26. Confirmed acceptable (user's device is on iOS 26).
- **No behavior changes.** Reducers, wiring, and tests are untouched except where a view needs a trivial binding for styling. `swift test` stays green (no reducer edits expected).
- **English UI; no i18n.** cs-CZ formatting unchanged.
- **Accessibility:** the glass material adapts to Reduce Transparency / Increase Contrast automatically — verify legibility under both before shipping.

## 4. Components

### 4.1 Palette additions (`swift/WatchtowerCore/Sources/WatchtowerCore/Theme/Palette.swift`)
Plain `Color` values (iOS-17-safe; no glass API), ported from `packages/ui-core/src/glass.ts`:
- `textSecondary` `#c2c9d8`
- `accentHover` `#7dd3fc`, `accentWash` `rgba(56,189,248,0.20)`
- `contentFill` `rgba(14,15,23,0.62)` (solid content-card fill — the "dataPanelFill" token)
- `hairline` `Color.white @ 0.10` (content border)
- Ambient gradient stops: `ambientSky #38bdf8@0.30`, `ambientCyan #22d3ee@0.20`, `ambientOcean #0284c7@0.24`
- Status-state colors (fill / border / accent), for the connection pill + authBlock banner:
  - connected: fill `rgba(26,90,66,0.34)`, accent `#34d399`
  - connecting: fill `rgba(20,52,92,0.45)`, accent `#60a5fa`
  - disconnected: fill `rgba(110,24,24,0.40)`, accent `#f87171`
  - authBlock: fill `rgba(120,82,8,0.40)`, accent `#f5a524`

(Skip the React `glassFill`/`glassFillStrong` rgba tokens — native glass replaces them. YAGNI.)

### 4.2 App-target design helpers (`apps/ipad-native/Watchtower/Design/`)
- `AmbientBackground.swift` — a `View` = `Color(baseBg)` + three `RadialGradient`s (sky top-leading, cyan top-trailing, ocean bottom-trailing) using the ambient stops. Applied once at the shell root, `.ignoresSafeArea()`.
- `GlassStyle.swift` — thin conveniences over the native API so call sites stay consistent:
  - a `floatingGlass(cornerRadius:tint:)` `ViewModifier` wrapping `.glassEffect(.regular[.tint], in: .rect(cornerRadius:))` for the rail/tab-strip/pill surfaces;
  - a `contentCard()` `ViewModifier` = solid `Palette.contentFill` + `RoundedRectangle.stroke(Palette.hairline)` for content surfaces (the A-option treatment);
  - a `statusGlass(state:)` helper mapping the four connection states to `.regular.tint(stateColor)`.
  - These are conveniences, not a framework — a call site may use `.glassEffect` directly when clearer.

### 4.3 View restyle (all in `apps/ipad-native/Watchtower/Views/`)
- **AppShellView** — root `ZStack { AmbientBackground(); HStack { rail; content } }`; drop the flat `Palette.baseBg` fill. Content detail area sits on the ambient bg (no glass).
- **RailView** — floating glass rail: wrap the item stack in a `GlassEffectContainer`; each item `.glassEffect(.regular, in: .rect(cornerRadius: 14))`, the selected item `.regular.tint(accentWash)`; inset the rail off the screen edge (leading + vertical padding) so it "floats". Status pill at the bottom uses `statusGlass`.
- **SettingsView** — section wrappers use `contentCard()` (solid). Primary action ("Save & connect") → `.buttonStyle(.glassProminent).tint(accent)`; "Sign in" likewise; secondary/"Sign out" → `.buttonStyle(.glass)`. Text fields keep stock styling on the solid card.
- **InstancesView** — tab strip is floating glass (`GlassEffectContainer` over the group tabs; active tab a tinted pill); the connection/authBlock banner uses `statusGlass`; "+ New" / "Remove" are glass buttons; the terminal detail area stays as-is (opaque terminal). Empty-state text on ambient bg.
- **SpawnModalView** — presented as a `.sheet` (already is) → it adopts Liquid Glass automatically on iOS 26; remove any custom flat panel background; content inside on solid/plain surfaces; the Spawn button `.glassProminent`.

### 4.4 System surfaces (free)
Toolbars, `NavigationStack` bars, and sheets adopt Liquid Glass automatically once the target is iOS 26 — no code. Audit: use `ToolbarSpacer()` for deliberate grouping; hide toolbar *items* (not their content) to avoid empty glass pills.

## 5. Data flow / architecture

No data-flow change. This is a presentation-only pass: `Palette` gains Colors; the app target gains a `Design/` folder; the five existing views swap flat fills for `AmbientBackground` + glass/`contentCard` modifiers. Reducers, `TerminalSession`, bridge, and tests are untouched.

## 6. Error handling / edge cases

- **Glass performance:** group co-located glass in a single `GlassEffectContainer` (rail items, tab-strip tabs); never stack glass-on-glass (glass can't sample glass); keep glass to the floating layer so on-screen glass count stays low (HIG perf guidance).
- **Legibility:** use `.regular` (not `.clear`) everywhere here (dark, potentially busy content). Test under Reduce Transparency + Increase Contrast.
- **Terminal:** never apply glass to the terminal body (`#0e0f12` opaque) — legibility + it's content-layer.

## 7. Testing & verification

- `swift test` stays green (no reducer changes; 296 at branch start) — a guard that this pass didn't alter behavior.
- App builds via `xcodebuild` for the iOS 26 simulator (`** BUILD SUCCEEDED **`).
- **Visual verification on the iOS 26 iPad sim** per screen (rail, settings, instances w/ terminal, spawn sheet) with before/after screenshots; confirm the ambient background + floating glass read correctly and content stays legible; spot-check Reduce Transparency.
- The prototype already proved the target bump + `glassEffect` compile and render on this toolchain (Xcode 26.5 / iOS 26.5 sim).

## 8. Out of scope

- No new features or screens (Dashboard/Billing/Records are Phase 5; their glass treatment follows the same "solid content, glass floating layer" rule when built).
- No changes to the iPhone app or `WatchtowerCore` behavior; no palette-color changes (only additions).
- No custom glass-morph animations (`glassEffectID` transitions) beyond what falls out naturally — can be a later polish.
- Light mode (the app is dark-only, `preferredColorScheme(.dark)`).
