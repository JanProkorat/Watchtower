# Native iPad Design Alignment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Make the native SwiftUI iPad app (`apps/ipad-native`) faithfully match the **original Capacitor iPad app** (`apps/ipad/`) design language — floating liquid-glass sidebar, ambient background, glass cards, and per-screen layouts — with only unavoidable SwiftUI-component differences. This is a **faithful port of the existing design**, NOT a redesign and NOT iPad-idiomatic reinvention.

**Governing principle (see memory `ipad-native-match-original-design`):** the design reference is **`apps/ipad/src/`** (Rail.tsx + `packages/module-timetracker/src/billing/*` + `packages/ui-core/src/glass.ts`), NOT the iPhone-native views. Keep **English** UI (cs-CZ formatting stays). Match layout structure, navigation, and glass material as closely as SwiftUI allows.

**Tech:** Swift/SwiftUI, TCA, iOS 26 (`.glassEffect` available). Reuse the existing WatchtowerCore reducers/derivations (unchanged) + `Palette` (hex already correct).

**Design reference map:** `docs/superpowers/specs/` (this alignment) + the original files above. Design-token source: `packages/ui-core/src/glass.ts`.

## Global Constraints
- **Faithful to `apps/ipad/`** — match each screen's layout/structure/material. Slight SwiftUI-component differences OK; overall look must match.
- **No reducer/data-plane/derivation changes** — this is view/shell layer only. `swift test` stays green.
- **Design tokens** already in `Palette.swift` (values synced to `glass.ts`). The gap is *application*: glass material + ambient background + sidebar + per-screen layout.
- **Glass material to port** (from `glass.ts`): `glassPanel` (radius 20, blur 34, saturate 1.8, brightness 1.18, fill `rgba(44,54,74,0.34)`, border `rgba(255,255,255,0.15)`), `glassCard` (radius 16, blur 28, saturate 1.7, brightness 1.14, border `rgba(255,255,255,0.10)`), `dataPanelFill` (`rgba(14,15,23,0.62)`, NON-frosted — for dense tables), `statusGlass(state)`. Native already has `floatingGlass` (`.glassEffect`) from #224 — align/extend it, add `glassCard`/`dataPanelFill`/ambient equivalents.
- **Ambient background**: 3 radial gradients over `#0a0d13` (values in `glass.ts` `ambientBackground`). Native has an `AmbientBackground` already — verify it matches.
- English UI, dark mode, iPad. Build gate: standard xcodegen + xcodebuild sim build → `** BUILD SUCCEEDED **`.
- Branch `feat/ipad-native-design-align` off `main` AFTER #226 + #227 merge.

---

### Task 1: Material system — glass cards, data panels, section header, ambient bg
**Files:** `apps/ipad-native/Watchtower/Design/GlassStyle.swift`, `Palette`/theme helpers, `AmbientBackground.swift`.
- Add SwiftUI equivalents matching `glass.ts`: `glassCard(radius:)` (frosted content card), `dataPanel()` (`dataPanelFill`, non-frosted, for ledger/grid/board), and a reusable `SectionHeaderLabel` (11pt, weight 700, tracking 0.8, uppercase, `Palette.textMuted`, 8pt bottom padding).
- Verify `AmbientBackground` matches the 3-radial-gradient wash. Verify `floatingGlass`/`glassPanel` corner-radius conventions (rail 20, card 16, tab 14, modal 22).
- [ ] Build; visually confirm a sample card matches the web glassCard.

### Task 2: Shell — floating glass sidebar (the biggest piece)  ⟵ CHECKPOINT
**Files:** `Views/RailView.swift` (rewrite → `SidebarView`), `Views/AppShellView.swift`, `IPadAppFeature` (add `billingSection` state + a rail-expanded/`billingExpanded` persisted flag, no reducer logic beyond nav state).
- Port `Rail.tsx`: floating glass panel (232 expanded / 52 collapsed, margin `13`, `glassPanel(radius:20)`), Watchtower logo (3-facet hex) + wordmark header (56pt row, hairline bottom); labeled nav rows (Přehled→"Dashboard", Instance→"Instances", Vzdálený Mac→"Remote Mac", Fakturace→"Billing", Nastavení→"Settings" — English labels, original glyphs), 40pt rows, radius 11, active = `accentWash` + inset ring, icon tint `accentIcon`.
- **Expandable Fakturace group**: chevron toggle, persisted (`@AppStorage`), 7 **flat** indented sub-items (Earnings/Reports/Seznam/Mřížka/Úkoly/Volno/Nástěnka → the `BillingSection` cases), 32pt rows; tapping a sub-item sets `activeModule=.billing` + `billingSection=<tab>` (mirror `selectBilling`). **Removes the Phase-5 segmented switcher.**
- Notifications footer row (bell + badge) + separate circular collapse toggle (persisted). (Notifications action can be a stub until Phase 7.)
- AppShellView: sidebar + content in a row over `AmbientBackground`; content routes on `activeModule`/`billingSection`.
- [ ] Build → SUCCEEDED. **[CHECKPOINT: deploy to device / sim, confirm the shell look matches the original before proceeding to screens — two-attempt UI rule.]**

### Task 3: Dashboard (Přehled) — vertical sections
**Files:** `Views/Billing/DashboardView.swift` (rewrite layout).
- Match `DashboardView.tsx`: single vertical scroll, 24pt section gaps, 16pt h-padding. ODPRACOVÁNO = 3 `KpiTile`s in a row (label/hours/CZK); AKTIVNÍ KONTRAKTY = stacked `ContractCard`s with `BurnBar` (8pt track, violet fill, amber overrun / cyan tick); TOP PROJEKTY = numbered list in one `glassCard` with proportional bars; AKTIVITA = 7-col heatmap + StatStrip. `SectionHeaderLabel` for each. Reuse the same derivations (already correct). **Drop the adaptive grid.**
- [ ] Build → SUCCEEDED.

### Task 4: Výdělky (Earnings) — list + push (not master-detail)
**Files:** `Views/Billing/EarningsView.swift`, `ProjectDetailView.swift` (rework nav).
- Match `EarningsMonthView.tsx`: vertical scroll — MonthPicker, hero total card, 8-month trend bars, "Projekty" `glassCard` list with `›` chevron rows → **push** `ProjectDetailView` (NavigationStack `.navigationDestination`, not a persistent split pane). ProjectDetail: sticky glass back bar, header card, "Historie sazeb" list (→ ContractDrawer sheet), "Výkazy" ledger as a `dataPanel` 4-col grid. Keep `canEdit` gating.
- [ ] Build → SUCCEEDED.

### Task 5: Reporty (Reports) — vertically stacked panels (not grid)
**Files:** `Views/Billing/ReportsView.swift`, `ReportsFilterBar.swift`.
- Match `ReportsView.tsx`: `ReportsFilterBar` (glassCard, 3 captioned fields — Období segmented / Rozlišení segmented / Projekt select) then **vertically stacked** sections: Trend / Výdělky (EarningsSummary) / Podle projektů (Donut) / Aktivita. **Drop the 2×2 grid.** Keep the value-only panels + Charts.
- [ ] Build → SUCCEEDED.

### Task 6: Records — Seznam / Mřížka / Úkoly (flat sidebar items)
**Files:** `Views/Billing/WorklogListView.swift`, `TaskGridView.swift`, `TaskListView.swift`, form sheets.
- These are now reached as **flat sidebar sub-items** (`records-list`/`records-grid`/`records-tasks`), not a segmented control. Match the web: Seznam = sticky MonthBar + day-grouped glass rows + WorklogDrawer; Mřížka = `dataPanel` spreadsheet (frozen Úkol+Σ cols, per-day cols, day-kind tints, footer totals); Úkoly = search bar + flat status-chip list + TaskDrawer. Keep `canEdit` gating.
- [ ] Build → SUCCEEDED.

### Task 7: Records — Volno (Time off) / Nástěnka (Board)
**Files:** `Views/Billing/TimeOffView.swift`, `BoardView.swift`.
- Volno: glass toolbar + legend chips; flex-wrap month-calendar `glassCard`s (3 months iPad), day-tap kind picker sheet; "Nadcházející" list. Nástěnka: read-only 3-column Kanban of `dataPanel` columns (240pt) with `BoardCardTile`s; project filter. (iPad-only Jira actions stay deferred.)
- [ ] Build → SUCCEEDED.

### Task 8: Instances / Remote Mac / Settings / Connection — glass chrome
**Files:** `Views/InstancesView.swift`, `Remote/RemoteView.swift`, `Views/SettingsView.swift`, connection editor.
- Apply the glass material + match the original chrome: Instances = centered pill glass TabStrip + tiled terminals (already close; align tab-strip styling); Remote Mac = glass credential card + statusGlass banner; Settings = centered max-width column with `glassCard(16)` "Účet" + "Připojení k Macu" cards (replace the native Form styling); Connection editor = glass inputs + WoL sub-section. Keep functionality.
- [ ] Build → SUCCEEDED.

### Task 9: Verification
- [ ] `swift test` green (no reducer changes). App BUILD SUCCEEDED; deploy to device; walk every screen and compare side-by-side to the original Capacitor app; record deviations; fix. Screenshot key screens.

---

## Plan self-review
- Reference is `apps/ipad/` throughout (not iphone-native). English kept; layouts + material matched. No reducer/data-plane changes (view/shell only) → `swift test` stays green. Shell-first with an explicit CHECKPOINT (two-attempt UI rule) before the per-screen work. Palette values already correct — only application changes.
