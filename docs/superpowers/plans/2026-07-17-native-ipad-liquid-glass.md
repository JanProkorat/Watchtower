# Native iPad Liquid Glass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. This is a **presentation-only** pass: verification is `xcodebuild` success + on-simulator screenshot inspected by the controller, NOT unit tests. `swift test` staying green is the regression guard that no behavior changed.

**Goal:** Restyle the native iPad app (`apps/ipad-native`) with Apple's native Liquid Glass (iOS 26) on the floating/functional layer + an ambient ocean background, keeping content on solid surfaces — matching the Capacitor iPad app's aesthetic.

**Architecture:** Bump the app target to iOS 26 (WatchtowerCore package stays iOS 17 — iPhone untouched; all glass code lives in the app target). Add Color tokens to `Palette.swift`, a `Design/` folder with an `AmbientBackground` + glass helper modifiers, then swap flat fills for ambient-bg + `.glassEffect`/`contentCard` across the five existing views. No reducer/behavior changes.

**Tech Stack:** SwiftUI, iOS 26 Liquid Glass API (`glassEffect`, `GlassEffectContainer`, `.buttonStyle(.glass/.glassProminent)`), XcodeGen.

**Spec:** `docs/superpowers/specs/2026-07-17-native-ipad-liquid-glass-design.md`

## Global Constraints

- **App target → iOS 26.0** (`apps/ipad-native/project.yml`). **`swift/WatchtowerCore/Package.swift` stays `.iOS(.v17)`** — do NOT bump it (the iPhone app links it). All `glassEffect`/glass-API calls live in the app target only; no `@available` guards needed.
- **Glass on the floating/functional layer ONLY.** Rail, tab strip, status/authBlock pills, floating buttons, sheets. **Content cards + form sections use a solid `contentCard` surface. Terminal body stays opaque.** (HIG.)
- Use `.regular` glass (dark, potentially busy content) — never `.clear` here. Group co-located glass in a single `GlassEffectContainer`; never stack glass-on-glass.
- **No behavior changes.** Reducers/wiring/tests untouched. `swift test` stays green (296 at branch start). If a view needs a `@Bindable`/binding tweak for styling, that's fine; do not touch reducer logic.
- English UI; no i18n. Dark mode only (`preferredColorScheme(.dark)`).
- Build (per view task): `cd apps/ipad-native && [ -f ../iphone-native/Watchtower/Secrets.xcconfig ] && cp ../iphone-native/Watchtower/Secrets.xcconfig Watchtower/Secrets.xcconfig || cp Watchtower/Secrets.sample.xcconfig Watchtower/Secrets.xcconfig; xcodegen generate && xcodebuild -project Watchtower.xcodeproj -scheme Watchtower -destination 'generic/platform=iOS Simulator' -skipMacroValidation -derivedDataPath build CODE_SIGNING_ALLOWED=NO build` → `** BUILD SUCCEEDED **`. Do NOT commit `Secrets.xcconfig` or the generated `.xcodeproj` (git-ignored).
- Work from worktree `/Users/jan/Projects/Watchtower/.claude/worktrees/ipad-native-glass` (branch `feat/ipad-native-liquid-glass`).
- Commit per task; trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

### Task 1: Foundation — target bump, palette tokens, Design helpers

**Files:**
- Modify: `apps/ipad-native/project.yml` (deploymentTarget iOS 17.0 → 26.0)
- Modify: `swift/WatchtowerCore/Sources/WatchtowerCore/Theme/Palette.swift` (add tokens)
- Create: `apps/ipad-native/Watchtower/Design/AmbientBackground.swift`
- Create: `apps/ipad-native/Watchtower/Design/GlassStyle.swift`

**Interfaces produced (consumed by Tasks 2–4):**
- `Palette.textSecondary`, `Palette.accentHover`, `Palette.accentWash`, `Palette.contentFill`, `Palette.hairline`, `Palette.ambientSky/ambientCyan/ambientOcean`, and `Palette.status(_ state:) -> (fill: Color, accent: Color)` for connection states `.connected/.connecting/.disconnected/.authBlock` (model the state enum where convenient, or use ConnStatus + an authBlock bool at call sites — keep it a simple mapping).
- `AmbientBackground` — a `View`.
- `View.contentCard(cornerRadius: CGFloat = 16)` — solid `Palette.contentFill` + hairline stroke.
- `View.floatingGlass(cornerRadius: CGFloat = 14, tint: Color? = nil)` — `.glassEffect(.regular[.tint(tint)], in: .rect(cornerRadius:))`.

- [ ] **Step 1: Bump the app target to iOS 26**

In `apps/ipad-native/project.yml`, change:
```yaml
  deploymentTarget:
    iOS: "26.0"
```
(Leave `swift/WatchtowerCore/Package.swift` untouched at `.iOS(.v17)`.)

- [ ] **Step 2: Add palette tokens**

In `Palette.swift`, add (reuse the file's existing hex→Color init pattern; add one if absent):
```swift
public static let textSecondary = Color(hex: 0xc2c9d8)
public static let accentHover   = Color(hex: 0x7dd3fc)
public static let accentWash    = Color(hex: 0x38bdf8, alpha: 0.20)
public static let contentFill   = Color(hex: 0x0e0f17, alpha: 0.62)
public static let hairline      = Color.white.opacity(0.10)
public static let ambientSky    = Color(hex: 0x38bdf8, alpha: 0.30)
public static let ambientCyan   = Color(hex: 0x22d3ee, alpha: 0.20)
public static let ambientOcean  = Color(hex: 0x0284c7, alpha: 0.24)

public enum ConnState { case connected, connecting, disconnected, authBlock }
public static func status(_ s: ConnState) -> (fill: Color, accent: Color) {
    switch s {
    case .connected:    return (Color(hex: 0x1a5a42, alpha: 0.34), Color(hex: 0x34d399))
    case .connecting:   return (Color(hex: 0x14345c, alpha: 0.45), Color(hex: 0x60a5fa))
    case .disconnected: return (Color(hex: 0x6e1818, alpha: 0.40), Color(hex: 0xf87171))
    case .authBlock:    return (Color(hex: 0x785208, alpha: 0.40), Color(hex: 0xf5a524))
    }
}
```
If `Palette` has no `Color(hex:alpha:)` init, add a private/internal one in the file.

- [ ] **Step 3: AmbientBackground**

Create `apps/ipad-native/Watchtower/Design/AmbientBackground.swift`:
```swift
import SwiftUI
import WatchtowerCore

struct AmbientBackground: View {
    var body: some View {
        ZStack {
            Palette.baseBg
            RadialGradient(colors: [Palette.ambientSky, .clear],   center: .topLeading,     startRadius: 0, endRadius: 620)
            RadialGradient(colors: [Palette.ambientCyan, .clear],  center: .topTrailing,    startRadius: 0, endRadius: 680)
            RadialGradient(colors: [Palette.ambientOcean, .clear], center: .bottomTrailing, startRadius: 0, endRadius: 760)
        }
        .ignoresSafeArea()
    }
}
```

- [ ] **Step 4: GlassStyle helpers**

Create `apps/ipad-native/Watchtower/Design/GlassStyle.swift`:
```swift
import SwiftUI
import WatchtowerCore

extension View {
    /// Floating/functional-layer glass (rail, tab strip, pills). Regular variant, optional tint.
    func floatingGlass(cornerRadius: CGFloat = 14, tint: Color? = nil) -> some View {
        glassEffect(tint.map { .regular.tint($0) } ?? .regular, in: .rect(cornerRadius: cornerRadius))
    }
    /// Content-layer surface — solid, NOT glass (HIG).
    func contentCard(cornerRadius: CGFloat = 16) -> some View {
        self
            .background(RoundedRectangle(cornerRadius: cornerRadius).fill(Palette.contentFill))
            .overlay(RoundedRectangle(cornerRadius: cornerRadius).stroke(Palette.hairline, lineWidth: 1))
    }
}
```
(The prototype confirmed this compiles + renders on iOS 26.5 / Xcode 26.5.)

- [ ] **Step 5: Build + verify package still green**

Run the Global-Constraints build command → `** BUILD SUCCEEDED **`. Then `cd swift/WatchtowerCore && swift test 2>&1 | tail -4` → still green (Palette additions are additive). No screenshot yet (no visible change until a view uses them).

- [ ] **Step 6: Commit**
```bash
git add apps/ipad-native/project.yml swift/WatchtowerCore/Sources/WatchtowerCore/Theme/Palette.swift apps/ipad-native/Watchtower/Design
git commit -m "feat(ipad-native): iOS 26 target + palette tokens + ambient bg / glass helpers"
```

---

### Task 2: Shell + Rail — ambient background + floating glass rail

**Files:**
- Modify: `apps/ipad-native/Watchtower/Views/AppShellView.swift`
- Modify: `apps/ipad-native/Watchtower/Views/RailView.swift`

**Interfaces:** consumes `AmbientBackground`, `floatingGlass`, `Palette.status`, `Palette.accentWash` (Task 1).

- [ ] **Step 1: AppShellView root = ambient background**

Replace the flat `.background(Palette.baseBg.ignoresSafeArea())` with a `ZStack { AmbientBackground(); <existing HStack of rail + detail> }`. The detail/content area keeps NO glass (sits on ambient bg). Keep the existing module switch + `.instances` routing untouched.

- [ ] **Step 2: RailView → floating glass**

- Wrap the rail's item `VStack` in a `GlassEffectContainer(spacing: 10)`.
- Each rail item: apply `.floatingGlass(cornerRadius: 14)`; the selected item `.floatingGlass(cornerRadius: 14, tint: Palette.accentWash)` and its icon/label `Palette.accent`, unselected `Palette.textMuted`. Remove the old `Color.white.opacity(0.03)` rail background and the `RoundedRectangle(...).fill(Color.white.opacity(0.08))` selection fill.
- Inset the rail so it floats: add leading + vertical padding (e.g. `.padding(.leading, 12).padding(.vertical, 16)`) — match the prototype's floating look.
- The bottom status pill: use a capsule `.floatingGlass(cornerRadius: 999, tint: Palette.status(state).fill)` with a glowing dot `Circle().fill(status.accent).shadow(color: status.accent, radius: 6)`, mapping the current `ConnStatus` (+ any authBlock signal available in this view) to `Palette.ConnState`.

- [ ] **Step 3: Build + screenshot**

Run the build. Then install + launch on the iOS 26 iPad sim and screenshot (controller inspects: floating glass rail over the ambient ocean glow; selected item tinted; status pill glassy). Reuse the Phase-1/2 sim flow (create/boot iPad sim on iOS 26 runtime if needed; the controller drives this).

- [ ] **Step 4: Commit**
```bash
git add apps/ipad-native/Watchtower/Views/AppShellView.swift apps/ipad-native/Watchtower/Views/RailView.swift
git commit -m "feat(ipad-native): ambient background + floating Liquid Glass rail"
```

---

### Task 3: SettingsView — solid content cards + glass buttons

**Files:**
- Modify: `apps/ipad-native/Watchtower/Views/SettingsView.swift`

**Interfaces:** consumes `contentCard`, `Palette.textSecondary`.

- [ ] **Step 1: Restyle**

- Wrap the "Mac connection" section and the "Supabase account" section each in a `.contentCard()` (solid — NOT glass).
- Primary actions: "Save & connect" and "Sign in" → `.buttonStyle(.glassProminent).tint(Palette.accent)`. Secondary ("Sign out", and the WoL disclosure toggle if styled as a button) → `.buttonStyle(.glass)`.
- Keep `TextField`/`SecureField` stock (`.roundedBorder`) on the solid card. Section headers use `Palette.textPrimary`; helper labels `Palette.textMuted`/`textSecondary`.
- Do NOT change any `store.send(...)` calls or the `ConnectionFeature`/`AuthFeature` scoping.

- [ ] **Step 2: Build + screenshot** (controller inspects: solid legible cards, glass CTA buttons pop against them).

- [ ] **Step 3: Commit**
```bash
git add apps/ipad-native/Watchtower/Views/SettingsView.swift
git commit -m "feat(ipad-native): Settings — solid content cards + glass action buttons"
```

---

### Task 4: InstancesView + SpawnModalView — glass tab strip, pills, sheet

**Files:**
- Modify: `apps/ipad-native/Watchtower/Views/InstancesView.swift`
- Modify: `apps/ipad-native/Watchtower/Views/SpawnModalView.swift`

**Interfaces:** consumes `floatingGlass`, `Palette.status`, `Palette.accentWash`.

- [ ] **Step 1: InstancesView**

- Tab strip: wrap the group-tab row in a `GlassEffectContainer`; each tab `.floatingGlass(cornerRadius: 12)`, the active tab tinted `Palette.accentWash`; keep the amber attention dot logic. Keep `store.send(.instanceSelected(...))` untouched.
- Connection/authBlock banner: style with `Palette.status(.authBlock)` glass (tinted capsule/banner) + keep the "Open Remote Mac" action (`onOpenRemote`).
- "+ New" → `.buttonStyle(.glassProminent).tint(Palette.accent)`; "Remove" (in the confirmationDialog trigger) → `.buttonStyle(.glass)`.
- **Terminal detail area stays exactly as-is** (opaque `RemoteTerminalView`) — do NOT wrap it in glass. Empty-state text sits on the ambient bg.

- [ ] **Step 2: SpawnModalView**

- It's presented via `.sheet` — on iOS 26 the sheet chrome adopts Liquid Glass automatically. Remove any custom flat panel background so the system glass shows; content rows on plain/solid surfaces. Spawn button → `.buttonStyle(.glassProminent).tint(Palette.accent)`; Cancel → `.buttonStyle(.glass)`. Keep the `isSubmitting` disable + all `store.send(...)`.

- [ ] **Step 3: Build + screenshot** (controller inspects: glass tab strip, glass spawn sheet, opaque terminal, tinted banner).

- [ ] **Step 4: Commit**
```bash
git add apps/ipad-native/Watchtower/Views/InstancesView.swift apps/ipad-native/Watchtower/Views/SpawnModalView.swift
git commit -m "feat(ipad-native): Instances tab strip + spawn sheet Liquid Glass; opaque terminal"
```

---

### Task 5: Full visual verification pass

**Files:** none (operational — controller-driven).

- [ ] **Step 1:** Confirm `cd swift/WatchtowerCore && swift test` is still green (296) — proves no behavior regressed.
- [ ] **Step 2:** On the iOS 26 iPad sim, screenshot each screen (Settings first-run, rail, Instances empty-state, spawn sheet) and confirm: ambient background reads; floating glass (rail/tab strip/pills/buttons/sheet) looks right; content cards + terminal stay solid/opaque + legible.
- [ ] **Step 3:** Toggle **Reduce Transparency** in the sim (Settings → Accessibility) and re-screenshot one glass-heavy screen; confirm nothing goes illegible (the material falls back automatically).
- [ ] **Step 4:** Note any surface that reads wrong; fix in a follow-up commit. (Two-attempt rule applies to any single surface that won't look right — stop and reassess after two tries.)

---

## Plan self-review (completed at authoring time)

- **Spec coverage:** target bump → T1; palette tokens → T1; AmbientBackground + glass helpers → T1; AppShellView/RailView → T2; SettingsView → T3; InstancesView/SpawnModalView → T4; system sheets/toolbars auto-glass (free); verification incl. Reduce Transparency → T5. Terminal-stays-opaque enforced in T4. All spec §4 items covered.
- **No behavior change:** every task explicitly preserves `store.send`/scoping; regression guard = `swift test` green in T1 + T5.
- **Type consistency:** `floatingGlass`/`contentCard`/`AmbientBackground`/`Palette.status(_:)`/`Palette.ConnState` + the new color tokens are named identically in T1 (definitions) and T2–T4 (uses).
- **Verification model:** build + screenshot (presentation-only), not TDD — stated in the header and each task; consistent with Phase 1 Task 10 / Phase 2 Tasks 6–7.
