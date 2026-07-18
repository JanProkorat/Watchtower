# Native iPad Phase 5 — Billing + Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Wire the existing (iPhone-shipped, fully-tested) WatchtowerCore billing/dashboard reducers into the native iPad app as iPad-sized SwiftUI screens — Dashboard, Earnings, Reports, Records (Worklog list / Task grid / Tasks / Time-off / Board) — replacing the two `.dashboard`/`.billing` placeholders.

**Architecture:** **Reuse, not rebuild.** Every reducer, data-plane client (`BillingClient`/`BillingCache`/`BillingWriteClient`), and pure derivation port already exists in `WatchtowerCore` and is 100% test-covered. Phase 5 adds (a) reducer *composition* into `IPadAppFeature` (Scopes + onAppear/authEvent fan-out, mirroring the iPhone `AppFeature`) and (b) new **build-verified** SwiftUI views in `apps/ipad-native/Watchtower/Views/Billing/` that bind those stores with wider iPad layouts (grids, side-by-side master-detail, 3-month strips), using the iPad design system (`contentCard()`/`floatingGlass()`/`Palette`/`AmbientBackground`) rather than the iPhone's app-local `GlassCard`. No reducer logic, no data-plane, no schema changes.

**Tech Stack:** Swift/SwiftUI, TCA, Swift Charts (system framework — no package change), XcodeGen. iOS 26 iPad target.

**Spec:** `docs/superpowers/specs/2026-07-15-native-ipad-swiftui-rewrite-design.md` (Phase 5 row, line 114; data flow §5). Issue #208.

**Reference (adapt, don't copy verbatim):** the iPhone-native views in `apps/iphone-native/Watchtower/Views/` (each named per task). Same stores; iPad = wider layout.

---

## Open design decisions (confirm before execution — recommended options marked ✅)

- **D1 — Billing container shape.** Under the `.billing` rail module, present Earnings / Reports / Records via **✅ a secondary segmented tab-strip** (matches the existing iPad `InstancesView` tab-strip pattern + the iPhone's own segmented Records) — vs a `NavigationSplitView` sidebar. Recommend the segmented strip: less new chrome, consistent with Instances.
- **D2 — Earnings/Reports → Project detail.** iPad has room for **✅ side-by-side master-detail** (project list + inline `ProjectDetailView`) instead of the iPhone's `.navigationDestination` push. Recommend master-detail for Earnings (the headline iPad win); Reports keeps its own project *filter* (no detail push).
- **D3 — Board (Kanban).** **✅ Read-only this phase** (reuse `buildBoard`; columns already fit iPad width). The iPad-only Jira re-sync / worklog-upload actions (old `docs/superpowers/plans/2026-07-03-ipad-jira-board-upload.md`) are a **separate later phase** — they need bridge RPCs, out of Phase 5's "reuse" character.
- **D4 — Attention bell.** **✅ Deferred to Phase 7** (Attention + push). The iPhone billing views take a `showAttention` binding for a bell toolbar; the iPad versions omit it (no attention wiring in Phase 5).
- **D5 — Auth gate.** **✅ No full-screen gate** (per the Capacitor precedent `docs/superpowers/plans/2026-07-12-ipad-billing-no-login-gate.md`): billing always renders cached/empty content; a "not signed in" bar + inline login sheet reuses the already-composed `AuthFeature`. Writes are gated by the session-agnostic `canEdit(loadState) == .fresh` rule already in the reducers.

---

## Global Constraints

- **Reuse only — no reducer/data-plane/schema changes.** All billing reducers (`BillingFeature`, `DashboardFeature`, `EarningsFeature`, `ReportsFeature`, `RecordsFeature`, `ProjectDetailFeature`, `ContractDrawerFeature`, `TaskFormFeature`, `WorklogFormFeature`, `TaskGrid`/`Board`/`TimeOff` pure ports) exist in `swift/WatchtowerCore/Sources/WatchtowerCore/` and are fully tested. The projects read-model gap (`task_url_template`/`is_pinned`/`archived`) is a **Phase 6 pre-task, NOT Phase 5** — do not touch `BillingFetchMapping`.
- **Views → app target** `apps/ipad-native/Watchtower/Views/Billing/` (new dir), build-verified. **Reducer composition → `WatchtowerBridge`** (`IPadAppFeature`), host-tested (Task 1 only).
- **iPad design system:** use `View.contentCard(cornerRadius:)` (solid content surface) + `View.floatingGlass(...)` (chrome) from `apps/ipad-native/Watchtower/Design/GlassStyle.swift`, shared `Palette` (`WatchtowerCore/Theme/Palette.swift`), and the existing `AmbientBackground` (already the shell's outer layer). Do NOT port the iPhone's app-local `GlassCard`/`.ultraThinMaterial`.
- **Formatting:** shared `CzFormat` (`WatchtowerCore/Formatting/CzFormat.swift`) — `czk`, `hours`, `dateCz`, `czechMonthLabel`, `addMonths`. CZK, cs-CZ, NBSP grouping.
- **Charts:** Swift Charts (`import Charts`) — system framework, no `project.yml`/`Package.swift` change (deployment target iOS 26). First Charts use in the iPad target.
- **English UI, dark mode only.**
- **Package tests:** `cd swift/WatchtowerCore && swift test` (**379 at branch start**, 0 failures) — must stay green; expected to remain 379 unless a task extracts a pure iPad-layout helper (then add its tests). **App build:** `cd apps/ipad-native && [ -f ../iphone-native/Watchtower/Secrets.xcconfig ] && cp ../iphone-native/Watchtower/Secrets.xcconfig Watchtower/Secrets.xcconfig || cp Watchtower/Secrets.sample.xcconfig Watchtower/Secrets.xcconfig; xcodegen generate && xcodebuild -project Watchtower.xcodeproj -scheme Watchtower -destination 'generic/platform=iOS Simulator' -skipMacroValidation -derivedDataPath build CODE_SIGNING_ALLOWED=NO build` → `** BUILD SUCCEEDED **`. Don't commit `Secrets.xcconfig`/`Watchtower.xcodeproj`.
- **Branch:** `feat/ipad-native-phase5` off `main` **after PR #226 (Phase 4) merges** (else branch off Phase 4 HEAD and rebase). Worktree `.claude/worktrees/ipad-native-phase5`. Commit per task; trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

### Task 1: Compose billing reducers into `IPadAppFeature` + auth affordance

**Files:**
- Modify: `swift/WatchtowerCore/Sources/WatchtowerBridge/Features/IPadAppFeature.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerBridgeTests/IPadAppFeatureTests.swift` (create/extend)

**Interfaces (consume from WatchtowerCore, mirror `AppFeature.swift:149-166`):**
- Add to `IPadAppFeature.State`: `var billing = BillingFeature.State()`, `var dashboard = DashboardFeature.State()`, `var earnings = EarningsFeature.State()`, `var reports = ReportsFeature.State()`, `var records = RecordsFeature.State()`. (Do NOT add `attention` — Phase 7.)
- Add matching `Action` cases (`case billing(BillingFeature.Action)` … `case records(RecordsFeature.Action)`) and `Scope`s in `body`.
- `onAppear` (and the existing `authEvent`) fan-out: on first appear / sign-in, send `.billing(.onAppear)`, `.earnings(.onAppear)`, `.reports(.onAppear(earliest: nil))`, `.records(.onAppear)` (mirror `AppFeature.swift:86-94`). Re-seed Reports `earliest` when the first dataset lands (mirror `AppFeature.swift:107-129`).
- Keep the iPad-specific note: Supabase auth does NOT gate the shell (only billing self-gates via `canEdit`).

**Steps:**
- [ ] **Step 1: Write/extend TestStore tests** — assert `onAppear` fans out the billing sub-actions; `authEvent(true)` triggers `billing` fetch; the first `billing(.fetchResponse)` re-seeds `reports.earliest`. Reuse the `AppFeatureTests` assertions as the template. RED.
- [ ] **Step 2: Implement** the state fields + Scopes + fan-out in `IPadAppFeature`.
- [ ] **Step 3: GREEN** — filtered + full `swift test` (379 + new IPadAppFeature assertions; no regressions).
- [ ] **Step 4: Commit** `feat(ipad-native): compose billing/dashboard reducers into IPadAppFeature (Phase 5)`.

---

### Task 2: Dashboard screen (`.dashboard` rail module)

**Files:**
- Create: `apps/ipad-native/Watchtower/Views/Billing/DashboardView.swift`
- Modify: `apps/ipad-native/Watchtower/Views/AppShellView.swift` (replace the `.dashboard` `PlaceholderView`)

**Reference:** `apps/iphone-native/Watchtower/Views/DashboardView.swift` (KPI grid, active contracts, top projects, 30-day heatmap).
**Stores/derivations:** `store.scope(state: \.billing, action: \.billing)` + `\.dashboard`; pure `dashboardKpis(_:today:)` (DashboardStats.swift), `contractBurn(...)`, `topProjects(...)`, `activityHeatmap(_:today:windowDays:)`. Read `billing.dataset`/`loadState`/`lastUpdated`.

- [ ] **Step 1:** Build `DashboardView` — iPad layout: a responsive card grid (`LazyVGrid` adaptive columns) with peer tiles: Worked KPIs, Active-contract burn cards, Top projects, Activity heatmap — using `contentCard()`. `.refreshable { store.send(.dashboard(...)) / .billing(.refreshRequested) }` + stale/offline/refresh-toast chrome from `billing.loadState`. Format via `CzFormat`.
- [ ] **Step 2:** Wire `AppShellView` `.dashboard` → `DashboardView(store:)`; `import WatchtowerCore`.
- [ ] **Step 3: Build** → `** BUILD SUCCEEDED **`.
- [ ] **Step 4: Commit** `feat(ipad-native): Dashboard screen (Phase 5)`.

---

### Task 3: `.billing` container switcher + auth affordance

**Files:**
- Create: `apps/ipad-native/Watchtower/Views/Billing/BillingView.swift`
- Create: `apps/ipad-native/Watchtower/Views/Billing/BillingAuthBar.swift`
- Modify: `apps/ipad-native/Watchtower/Views/AppShellView.swift` (replace the `.billing` `PlaceholderView`)

**Design (D1 ✅ segmented, D5 ✅ no-gate):** `BillingView` renders a secondary segmented tab-strip (Earnings | Reports | Records) — reuse the `InstancesView` `ScrollView(.horizontal)` + `GlassEffectContainer` tab-strip pattern — switching among the Task-4/5/6/7 sub-screens. A `BillingAuthBar` (shown when `!store.authPresent`) offers "Sign in" → a login sheet bound to `store.scope(state: \.auth, action: \.auth)` (reuse `AuthFeature`; adapt the iPhone auth form — iPad has none). Content always renders (cached/empty) regardless of auth.

- [ ] **Step 1:** `BillingView` segmented switcher + `@State private var section` (earnings/reports/records) or drive off local state; embed the sub-screens (stubs until Tasks 4-7 land — this task ships the container + Earnings placeholder, or sequence Task 3 after 4-7; controller's call).
- [ ] **Step 2:** `BillingAuthBar` + login sheet (reuse `AuthFeature`).
- [ ] **Step 3:** Wire `AppShellView` `.billing` → `BillingView(store:)`.
- [ ] **Step 4: Build** → SUCCEEDED. **Step 5: Commit** `feat(ipad-native): Billing container + auth bar (Phase 5)`.

---

### Task 4: Earnings + Project detail (master-detail) + Contract drawer

**Files:**
- Create: `apps/ipad-native/Watchtower/Views/Billing/EarningsView.swift`, `ProjectDetailView.swift`, `ContractDrawerView.swift`

**Reference:** iphone `EarningsView.swift`, `ProjectDetailView.swift`, `ContractDrawerView.swift`.
**Stores:** `\.earnings` (`EarningsFeature`: `selectedMonth`, `monthStepped`, `openProjectTapped(Int)`, `@Presents projectDetail`), `ProjectDetailFeature` (via the presented scope), `ContractDrawerFeature` (via ProjectDetail's presented scope). Derivations: `aggregateMonthEarnings`, `trailingMonths`, `topProjects`; `activeContract`, `rollupEarningsByContract`, `contractBurn`.

- [ ] **Step 1:** `EarningsView` — **D2 ✅ master-detail**: month stepper + hero total + 8-month trend + project list on the leading pane; the presented `ProjectDetailView` inline on the trailing pane (drive off `earnings.projectDetail` presentation). Fall back to list-only when nothing selected.
- [ ] **Step 2:** `ProjectDetailView` (header / rate-history / monthly ledger) + `ContractDrawerView` as a `.sheet` bound to its presented scope; edits gated by `canEdit(billing.loadState)`.
- [ ] **Step 3: Build** → SUCCEEDED. **Step 4: Commit** `feat(ipad-native): Earnings + project detail + contract drawer (Phase 5)`.

---

### Task 5: Reports (2×2 panel grid + Swift Charts)

**Files:**
- Create: `apps/ipad-native/Watchtower/Views/Billing/ReportsView.swift`, `ReportsFilterBar.swift`, `TrendChartPanel.swift`, `ProjectDonutPanel.swift`, `EarningsSummaryPanel.swift`, `ActivityHeatmapPanel.swift`

**Reference:** the four iphone panels are **value-only** (no store) — near-verbatim reuse; only the filter bar changes layout.
**Stores/derivations:** `\.reports` (`ReportsFeature`: `preset`, `granularity`, `projectId`, computed `range`); `trendSeries`, `rateChangeMarkers`, `projectBreakdown`, `earningsSummary`, `activityHeatmapRange`.

- [ ] **Step 1:** Port the 4 panels (Charts `BarMark`/`SectorMark` for Trend/Donut; hand-rolled heatmap/summary) using `contentCard()` + `Palette.chart*` colors + `CzFormat`.
- [ ] **Step 2:** `ReportsFilterBar` — **iPad horizontal** row (Period / Granularity / Project) instead of the iPhone's stacked fields.
- [ ] **Step 3:** `ReportsView` — 2×2 `LazyVGrid` of the panels below the filter bar.
- [ ] **Step 4: Build** → SUCCEEDED. **Step 5: Commit** `feat(ipad-native): Reports 2x2 panel grid + charts (Phase 5)`.

---

### Task 6: Records — Worklog list + Task grid + Tasks + form sheets

**Files:**
- Create: `apps/ipad-native/Watchtower/Views/Billing/RecordsView.swift`, `WorklogListView.swift`, `TaskGridView.swift`, `TaskListView.swift`, `WorklogFormView.swift`, `TaskFormView.swift`

**Reference:** iphone `RecordsView` (segmented over `RecordsFeature.Section`), `WorklogListView`, `TaskGridView` (read-only), `TaskListView`, form views.
**Stores:** `\.records` (`RecordsFeature`: `section`, month/project steppers, `addWorklogTapped`/`worklogRowTapped`, `addTaskTapped`/`taskRowTapped`, `@Presents worklogForm`/`taskForm`); `WorklogFormFeature`/`TaskFormFeature` via presented scopes. Derivations: `groupWorklogsByDay`, `buildTaskGrid`, `gridDayMeta`, `expectedEarnings`. Writes gated by `canEdit`.

- [ ] **Step 1:** `RecordsView` — the 5-section switcher (list/grid/tasks/timeOff/board); this task wires list/grid/tasks (timeOff+board in Task 7). Keep the iPhone segmented control or widen naturally.
- [ ] **Step 2:** `WorklogListView` (month-grouped) + `WorklogFormView` sheet; `TaskListView` (search + list) + `TaskFormView` sheet; `TaskGridView` (frozen-left + horizontal day columns — read-only, shows more columns on iPad width).
- [ ] **Step 3: Build** → SUCCEEDED. **Step 4: Commit** `feat(ipad-native): Records — worklog list, task grid, tasks, forms (Phase 5)`.

---

### Task 7: Records — Time off (3-month) + Board (read-only)

**Files:**
- Create: `apps/ipad-native/Watchtower/Views/Billing/TimeOffView.swift`, `BoardView.swift`
- (Optional) Create: a pure 3-month layout helper in `WatchtowerCore/Billing/records/` + test, only if layout math must leave the view.

**Reference:** iphone `TimeOffView` (renders only `model.months[1]`) + `BoardView` (3 columns, read-only). `buildTimeOffModel` already returns `[prev, focus, next]`; `buildBoard` is pure.
**Stores/derivations:** `\.records` (`timeOffFocus`, `setDayOff`/`clearDayOff` with 3-tier `sync_id` resolution; `boardProjectId`); `buildTimeOffModel`, `buildBoard`. Port `boardHoursFormatter` (BoardView.swift:234-243) verbatim.

- [ ] **Step 1:** `TimeOffView` — render all 3 months (`model.months[0..2]`) side-by-side (iPad strip); day-off toggles via `setDayOff`/`clearDayOff`, gated by `canEdit`.
- [ ] **Step 2:** `BoardView` — read-only kanban (project `Menu` filter + 3 columns of cards). No Jira/upload actions (D3 — deferred).
- [ ] **Step 3: Build** → SUCCEEDED. **Step 4: Commit** `feat(ipad-native): Records — time-off 3-month strip + read-only board (Phase 5)`.

---

### Task 8: Verification

**Files:** none (operational).

- [ ] **Step 1:** `cd swift/WatchtowerCore && swift test` green (379 + any Task-1/7 additions).
- [ ] **Step 2:** App `** BUILD SUCCEEDED **`; launch on the iOS 26 iPad sim; navigate Dashboard + Billing (Earnings/Reports/Records/Time-off/Board); confirm no crash and layouts render (empty/cached state without a live Supabase session is expected — the sample Secrets has no anon key). Screenshot each.
- [ ] **Step 3 (needs a signed-in Supabase session):** on device — Dashboard/Earnings/Reports/Records render live billing data with iPad layouts; a worklog/task/contract edit + a day-off toggle round-trips to Supabase (respecting the `canEdit`/`lockedThrough` gates). Record deviations; fix individually.

---

## Plan self-review (completed at authoring time)

- **Spec coverage (Phase 5 row):** Dashboard → T2; Earnings → T4; Reports → T5; Records (list/grid/tasks) → T6; Time-off + Board → T7; iPad layouts (grids/split/side-by-side) → T2/T4/T5/T7; billing self-gates (no shell gate) → T1/T3 (D5). Attention-adjacent billing → Attention deferred to Phase 7 (D4). Project page is Phase 6 (not here).
- **No reducer/data-plane changes:** confirmed — all reducers/clients/derivations exist + are tested; Task 1 only *composes* them (Scopes + fan-out) with TestStore coverage. `swift test` stays 379 (+ composition assertions).
- **Reuse discipline:** value-only panels (Trend/Donut/EarningsSummary/Heatmap) and pure derivations are drop-in; the *only* new logic risk is iPad layout code (build-verified) — hence build-gate every view task.
- **Design consistency:** iPad `contentCard()`/`floatingGlass()`/`Palette`/`AmbientBackground` (not the iPhone `GlassCard`); `CzFormat` for all currency/hours/dates.
- **Verification model:** composition is host-tested (T1); views are build-verified (T2-T7); live billing data + write round-trips are on-device (T8 Step 3, needs a Supabase session).
- **Open decisions D1-D5** flagged at top for confirmation before execution — none block writing the plan, but D1/D2/D3 change view shape.
