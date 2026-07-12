# Native iPhone — Phase 3 (Reports + Swift Charts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the native **Reports** tab — a filter bar (period / granularity / project) driving four panels (trend bar chart, earnings summary, project donut, activity heatmap) — porting the range-scoped report aggregations verbatim and rendering charts with **Swift Charts**.

**Architecture:** New report aggregations live in `WatchtowerCore/Billing/reports/` (ported verbatim from `packages/shared/src/billing/reports/*`), reusing the Phase-2 models + `CzFormat`. A `ReportsFeature` TCA reducer owns the filter state (preset, granularity, projectId) and derives `from/to/granularity`. `ReportsView` reads the shared `BillingFeature.dataset`, computes each panel's data with the pure functions, and renders the filter bar + 4 panels; it is embedded in `AppFeature` via `Scope` and shown in the Reports tab.

**Tech Stack:** Swift 5.10+, SwiftUI, **Swift Charts** (`import Charts`), The Composable Architecture, XCTest via TestStore, XcodeGen, Xcode 26.

## Global Constraints

- **Builds on Phases 1-2** (merged to main). Reuse: `WatchtowerCore` models (`WorklogRow`/`ContractRow`/`ProjectRow`/`ProjectEarning`), `CzFormat` (czk/hours/dateCz), `Palette` (+ chart tokens), `BillingFeature` (shared `dataset` via `billing` scope), the Phase-2 `Heatmap.swift` `buildHeatmap` engine. Do NOT duplicate or regress these.
- **iOS 17.0; TCA**; all I/O via `@Dependency`; reducers pure.
- **Read-only phase.** Worklogs carry server-computed `effectiveMinutes`/`earnedAmount`. No mutations.
- **Verbatim ports.** Report aggregation math must match `packages/shared/src/billing/reports/{buckets,trend,earnings-summary,breakdown}.ts` and the `useReportsFilters.ts` preset/granularity/clamp logic exactly. The TDD vectors are the contract; if a supplied vector fails, fix the port against the cited source, never the vector.
- **Date discipline (UTC).** All date math (bucket keys, preset ranges, day stepping, span) uses a **UTC** `Calendar` or pure integer/string math — never the device local zone. `today` is the UTC calendar date.
- **cs-CZ formatting** via the existing `CzFormat` (NBSP currency, comma hours, no-leading-zero dates). No new formatters.
- **UI English** (period/granularity/panel labels). Only cs-CZ number/date formatting is Czech.
- **Swift Charts** for the trend bar chart and the project donut; the activity heatmap stays a hand-built grid (reuse the Phase-2 Dashboard heatmap cell style). `import Charts`.
- **Headless `xcodebuild` needs** `-skipMacroValidation -skipPackagePluginValidation`; regenerate with `xcodegen generate` after adding app-target files.
- **Chart palette:** reuse `Palette.accent` (#7c6df0) / `chartViolet` / `chartCyan` / `chartAmber`. The donut's no-color fallback cycles an 8-color categorical palette (see Task 10). Note the React "violet" token is actually cyan `#38bdf8` = the app accent; use `Palette.accent` for the primary series color.

---

## File Structure

```
swift/WatchtowerCore/Sources/WatchtowerCore/
├─ Billing/reports/
│  ├─ Buckets.swift            # Granularity enum, bucketKey, enumerateBuckets
│  ├─ ReportRange.swift        # Preset enum, resolvePreset, defaultGranularity, clampGranularity, addDaysUTC, spanDays
│  ├─ Trend.swift              # TrendBucket, RateMarker, trendSeries, rateChangeMarkers
│  ├─ EarningsSummary.swift    # EarningsSummaryResult, earningsSummary
│  └─ Breakdown.swift          # ProjectBreakdownSlice, projectBreakdown
├─ Billing/Heatmap.swift       # MODIFY: add public activityHeatmapRange(rows, from, to)
└─ Features/
   ├─ ReportsFeature.swift     # filter state + derived range/granularity
   └─ AppFeature.swift         # MODIFY: embed reports via Scope; fire reports.onAppear on sign-in

swift/WatchtowerCore/Tests/WatchtowerCoreTests/
├─ BucketsTests.swift  ReportRangeTests.swift  TrendTests.swift
├─ EarningsSummaryTests.swift  BreakdownTests.swift  HeatmapRangeTests.swift
├─ ReportsFeatureTests.swift  AppFeatureTests.swift (MODIFY)

apps/iphone-native/Watchtower/Views/
├─ ReportsView.swift           # composes filter bar + 4 panels; loading gate
├─ ReportsFilterBar.swift      # period/granularity/project controls
├─ TrendChartPanel.swift       # Swift Charts BarMark + tap-select + rate markers
├─ ProjectDonutPanel.swift     # Swift Charts SectorMark donut + legend (tap → openProject)
├─ EarningsSummaryPanel.swift  # 4 stat tiles + per-project bars (tap → openProject)
├─ ActivityHeatmapPanel.swift  # heatmap grid + stats (tap-to-reveal)
└─ AppShellView.swift          # MODIFY: render ReportsView in the .reports tab
```

---

### Task 1: Buckets (bucketKey + enumerateBuckets)

Port `packages/shared/src/billing/reports/buckets.ts`. The week key mirrors SQLite `strftime('%Y-W%W')` (Monday-first, week 00 before the first Monday) — port the integer math exactly.

**Files:** Create `swift/WatchtowerCore/Sources/WatchtowerCore/Billing/reports/Buckets.swift`; Test `.../BucketsTests.swift`.

**Interfaces:**
- `enum Granularity: String, CaseIterable, Sendable, Equatable { case day, week, month }`
- `func bucketKey(_ date: String, _ granularity: Granularity) -> String`
- `func enumerateBuckets(_ from: String, _ to: String, _ granularity: Granularity) -> [String]`

- [ ] **Step 1: Write the failing tests**
```swift
import XCTest
@testable import WatchtowerCore

final class BucketsTests: XCTestCase {
    func testBucketKeyDayMonth() {
        XCTAssertEqual(bucketKey("2026-06-07", .day), "2026-06-07")
        XCTAssertEqual(bucketKey("2026-06-07", .month), "2026-06")
    }
    func testBucketKeyWeek() {
        // 2026-01-01 is Thursday → week 00 (before first Monday 2026-01-05)
        XCTAssertEqual(bucketKey("2026-01-01", .week), "2026-W00")
        XCTAssertEqual(bucketKey("2026-01-04", .week), "2026-W00") // Sunday, still pre-first-Monday
        XCTAssertEqual(bucketKey("2026-01-05", .week), "2026-W01") // first Monday
        XCTAssertEqual(bucketKey("2026-01-12", .week), "2026-W02")
    }
    func testEnumerateBucketsWeek() {
        XCTAssertEqual(enumerateBuckets("2026-01-01", "2026-01-14", .week), ["2026-W00", "2026-W01", "2026-W02"])
    }
    func testEnumerateBucketsDayInclusive() {
        XCTAssertEqual(enumerateBuckets("2026-06-06", "2026-06-08", .day), ["2026-06-06", "2026-06-07", "2026-06-08"])
    }
}
```
- [ ] **Step 2:** Run `swift test --filter BucketsTests` → FAIL.
- [ ] **Step 3:** Implement `Buckets.swift` porting `buckets.ts`. Week math: `yday` = 0-based day-of-year (days from Jan 1 UTC), `daysSinceMonday = (weekdayMon0) `where Monday=0..Sunday=6 (from a UTC Gregorian weekday: Sunday=1..Saturday=7 → `(weekday + 5) % 7`), `week = (yday - daysSinceMonday + 7) / 7` integer floor; key = `"\(y)-W" + String(format:"%02d", week)`. Use a UTC `Calendar` for day-of-year + weekday + day stepping. `enumerateBuckets` walks day-by-day inclusive, dedupes preserving first-seen order.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(ios): report bucket keys (port of buckets.ts)`.

---

### Task 2: Report range/preset helpers

Port the pure parts of `packages/shared/src/billing/../useReportsFilters.ts` (`resolvePreset`, `defaultGranularity`, `clampGranularity`, `addDays`/`spanDays`). These are the view-state math; keep them in `WatchtowerCore` for testability.

**Files:** Create `.../Billing/reports/ReportRange.swift`; Test `.../ReportRangeTests.swift`.

**Interfaces:**
- `enum Preset: String, CaseIterable, Sendable, Equatable { case d7 = "7d", d30 = "30d", month, year, all }`
- `func addDaysUTC(_ date: String, _ n: Int) -> String`
- `func spanDays(_ from: String, _ to: String) -> Int` (inclusive day count)
- `func resolvePreset(_ preset: Preset, today: String, earliest: String?) -> (from: String, to: String)`
- `func defaultGranularity(_ preset: Preset) -> Granularity`
- `func clampGranularity(_ g: Granularity, from: String, to: String) -> Granularity`

> `resolvePreset`: `.d7`→`(addDaysUTC(today,-6), today)`; `.d30`→`(addDaysUTC(today,-29), today)`; `.month`→`(String(today.prefix(7))+"-01", today)`; `.year`→`(String(today.prefix(4))+"-01-01", today)`; `.all`→`(earliest ?? today, today)`. `defaultGranularity`: `.year`/`.all`→`.month`, else `.day`. `clampGranularity`: `span = spanDays(from,to)`; if `.day` && span>92 → `.week`; if (result is) `.week` && span>1100 → `.month` (apply sequentially so a huge day-range can end at month). `spanDays` inclusive = day-diff + 1.

- [ ] **Step 1: Write the failing tests**
```swift
import XCTest
@testable import WatchtowerCore

final class ReportRangeTests: XCTestCase {
    func testResolvePreset() {
        XCTAssertEqual(resolvePreset(.d7, today: "2026-06-30", earliest: nil).from, "2026-06-24")
        XCTAssertEqual(resolvePreset(.d30, today: "2026-06-30", earliest: nil).from, "2026-06-01")
        XCTAssertEqual(resolvePreset(.month, today: "2026-06-15", earliest: nil).from, "2026-06-01")
        XCTAssertEqual(resolvePreset(.year, today: "2026-06-15", earliest: nil).from, "2026-01-01")
        XCTAssertEqual(resolvePreset(.all, today: "2026-06-15", earliest: "2025-03-02").from, "2025-03-02")
        XCTAssertEqual(resolvePreset(.all, today: "2026-06-15", earliest: nil).from, "2026-06-15")
    }
    func testSpanDaysInclusive() {
        XCTAssertEqual(spanDays("2026-06-01", "2026-06-01"), 1)
        XCTAssertEqual(spanDays("2026-06-01", "2026-06-30"), 30)
    }
    func testDefaultAndClamp() {
        XCTAssertEqual(defaultGranularity(.year), .month)
        XCTAssertEqual(defaultGranularity(.d7), .day)
        // 366-day range with .day → clamps to .week
        XCTAssertEqual(clampGranularity(.day, from: "2025-01-01", to: "2026-01-01"), .week)
        XCTAssertEqual(clampGranularity(.day, from: "2026-06-01", to: "2026-06-30"), .day) // 30 ≤ 92
    }
}
```
- [ ] **Steps 2-5:** RED → implement `ReportRange.swift` (reuse a UTC day helper; you MAY factor a shared internal UTC-day util) → PASS → commit `feat(ios): report preset/range/granularity helpers`.

---

### Task 3: trendSeries + rateChangeMarkers

Port `packages/shared/src/billing/reports/trend.ts`.

**Files:** Create `.../Billing/reports/Trend.swift`; Test `.../TrendTests.swift`.

**Interfaces:**
- `struct TrendBucket: Equatable, Sendable { let bucket: String; let minutes: Double; let earnedCzk: Double }`
- `struct RateMarker: Equatable, Sendable { let effectiveFrom: String; let rateType: String; let rateAmount: Double }`
- `func trendSeries(_ rows: [WorklogRow], from: String, to: String, granularity: Granularity, projectId: Int?) -> [TrendBucket]`
- `func rateChangeMarkers(_ contracts: [ContractRow], from: String, to: String, projectId: Int?) -> [RateMarker]`

> `trendSeries`: filter `from <= workDate <= to` and (projectId==nil || r.projectId==projectId); bucket via `bucketKey`; sum `effectiveMinutes` always, `earnedAmount` only when non-nil; return sorted ascending by bucket string. `rateChangeMarkers`: `projectId==nil` → `[]`; else that project's contracts sorted by `effectiveFrom`, **drop the first** (`.dropFirst()`), filter `from <= effectiveFrom <= to`, map to markers.

- [ ] **Step 1: Write the failing tests**
```swift
import XCTest
@testable import WatchtowerCore

final class TrendTests: XCTestCase {
    private func wl(_ d: String, _ pid: Int, _ eff: Double, _ earned: Double?) -> WorklogRow {
        WorklogRow(syncId: "\(d)-\(pid)", workDate: d, minutes: eff, reportedMinutes: nil, effectiveMinutes: eff,
            earnedAmount: earned, description: nil, projectId: pid, projectName: "P", projectColor: nil,
            projectKind: "work", isBillable: true, taskNumber: nil, taskTitle: nil, source: nil)
    }
    func testTrendSeriesMonthly() {
        let rows = [wl("2026-05-10",1,60,1000), wl("2026-06-01",1,30,500), wl("2026-06-02",1,30,nil), wl("2026-07-01",2,60,900)]
        let t = trendSeries(rows, from: "2026-05-01", to: "2026-06-30", granularity: .month, projectId: nil)
        XCTAssertEqual(t.map(\.bucket), ["2026-05","2026-06"])
        XCTAssertEqual(t.first(where:{$0.bucket=="2026-06"})?.minutes, 60)
        XCTAssertEqual(t.first(where:{$0.bucket=="2026-06"})?.earnedCzk, 500) // one row nil-earned
    }
    func testTrendSeriesProjectFilter() {
        let rows = [wl("2026-06-01",1,60,100), wl("2026-06-01",2,90,200)]
        let t = trendSeries(rows, from: "2026-06-01", to: "2026-06-30", granularity: .month, projectId: 2)
        XCTAssertEqual(t.map(\.minutes), [90])
    }
    func testRateMarkersDropFirstAndFilter() {
        func c(_ ef: String) -> ContractRow { ContractRow(syncId: ef, projectId: 1, effectiveFrom: ef, endDate: nil,
            rateType: "hourly", rateAmount: 1000, hoursPerDay: 8, mdLimit: nil, contractGroupId: nil) }
        let contracts = [c("2026-01-01"), c("2026-03-01"), c("2026-08-01")]
        let m = rateChangeMarkers(contracts, from: "2026-01-01", to: "2026-06-30", projectId: 1)
        XCTAssertEqual(m.map(\.effectiveFrom), ["2026-03-01"]) // first dropped, 08-01 out of range
        XCTAssertTrue(rateChangeMarkers(contracts, from: "2026-01-01", to: "2026-06-30", projectId: nil).isEmpty)
    }
}
```
- [ ] **Steps 2-5:** RED → implement `Trend.swift` (first-seen grouping order irrelevant since sorted by bucket) → PASS → commit `feat(ios): trend series + rate-change markers (port of trend.ts)`.

---

### Task 4: earningsSummary

Port `packages/shared/src/billing/reports/earnings-summary.ts` (range-scoped; distinct from Phase-2 `aggregateMonthEarnings` — adds billable/unbillable minute splits + avg rate).

**Files:** Create `.../Billing/reports/EarningsSummary.swift`; Test `.../EarningsSummaryTests.swift`.

**Interfaces:**
- `struct EarningsSummaryResult: Equatable, Sendable { let totalCzk: Double; let billableMinutes: Double; let unbillableMinutes: Double; let avgEffectiveHourlyRateCzk: Double?; let perProject: [ProjectEarning] }`
- `func earningsSummary(_ rows: [WorklogRow], from: String, to: String, projectId: Int?) -> EarningsSummaryResult`

> In-range + optional projectId filter. `billableMinutes` += effectiveMinutes where `projectKind=="work" && isBillable`; `unbillableMinutes` += where `projectKind=="work" && !isBillable`. When `isBillable && earnedAmount != nil`: `totalCzk += earnedAmount`, `czkBillableMinutes += effectiveMinutes`, accumulate `perProject` (first-seen name/color). `avgEffectiveHourlyRateCzk = czkBillableMinutes>0 ? totalCzk/(czkBillableMinutes/60) : nil`. `perProject` sorted `earnedCzk` desc (add first-seen tie-break for determinism, consistent with Phase-2 Earnings).

- [ ] **Step 1: Write the failing tests**
```swift
import XCTest
@testable import WatchtowerCore

final class EarningsSummaryTests: XCTestCase {
    private func wl(_ pid: Int, _ eff: Double, _ earned: Double?, kind: String = "work", billable: Bool = true) -> WorklogRow {
        WorklogRow(syncId: "\(pid)-\(eff)", workDate: "2026-06-10", minutes: eff, reportedMinutes: nil, effectiveMinutes: eff,
            earnedAmount: earned, description: nil, projectId: pid, projectName: "P\(pid)", projectColor: nil,
            projectKind: kind, isBillable: billable, taskNumber: nil, taskTitle: nil, source: nil)
    }
    func testSummary() {
        let rows = [
            wl(1, 60, 1000),                       // billable czk
            wl(1, 60, 1000),                       // billable czk
            wl(2, 120, nil, billable: false),      // work unbillable
            wl(3, 30, 500, kind: "personal"),      // billable czk but not work-kind (counts czk, not billable/unbillable minutes)
        ]
        let r = earningsSummary(rows, from: "2026-06-01", to: "2026-06-30", projectId: nil)
        XCTAssertEqual(r.totalCzk, 2500)
        XCTAssertEqual(r.billableMinutes, 120)     // project 1's two work+billable rows
        XCTAssertEqual(r.unbillableMinutes, 120)   // project 2
        // czkBillableMinutes = 120 (p1) + 30 (p3, isBillable) = 150 → avg = 2500/(150/60) = 1000
        XCTAssertEqual(r.avgEffectiveHourlyRateCzk!, 1000, accuracy: 0.001)
        XCTAssertEqual(r.perProject.map(\.projectId), [1, 3]) // by earnedCzk desc: 2000, 500
    }
    func testEmptyRateIsNil() {
        XCTAssertNil(earningsSummary([], from: "2026-06-01", to: "2026-06-30", projectId: nil).avgEffectiveHourlyRateCzk)
    }
}
```
- [ ] **Steps 2-5:** RED → implement `EarningsSummary.swift` → PASS → commit `feat(ios): earnings summary (port of earnings-summary.ts)`.

---

### Task 5: projectBreakdown

Port `packages/shared/src/billing/reports/breakdown.ts` (donut slices with share).

**Files:** Create `.../Billing/reports/Breakdown.swift`; Test `.../BreakdownTests.swift`.

**Interfaces:**
- `struct ProjectBreakdownSlice: Equatable, Sendable { let projectId: Int; let name: String; let color: String?; let minutes: Double; let earnedCzk: Double; let share: Double }`
- `func projectBreakdown(_ rows: [WorklogRow], from: String, to: String) -> [ProjectBreakdownSlice]`

> In-range (no projectId filter). Per-project sum `effectiveMinutes` + `earnedCzk` (earnedAmount non-nil). Filter `minutes > 0`. `share = total>0 ? minutes/total : 0` (total = Σ slice minutes). Sort `minutes` desc, then `name` **localizedCompare** ascending, then first-seen for determinism.

- [ ] **Step 1: Write the failing tests**
```swift
import XCTest
@testable import WatchtowerCore

final class BreakdownTests: XCTestCase {
    private func wl(_ pid: Int, _ name: String, _ eff: Double, _ earned: Double?) -> WorklogRow {
        WorklogRow(syncId: "\(pid)-\(eff)", workDate: "2026-06-10", minutes: eff, reportedMinutes: nil, effectiveMinutes: eff,
            earnedAmount: earned, description: nil, projectId: pid, projectName: name, projectColor: nil,
            projectKind: "work", isBillable: true, taskNumber: nil, taskTitle: nil, source: nil)
    }
    func testBreakdownShares() {
        let rows = [wl(1,"Alpha",60,1000), wl(2,"Beta",180,3000), wl(3,"Gamma",0,nil)]
        let s = projectBreakdown(rows, from: "2026-06-01", to: "2026-06-30")
        XCTAssertEqual(s.map(\.projectId), [2, 1])          // 180 desc, then 60; zero-minute Gamma filtered
        XCTAssertEqual(s.first?.share ?? 0, 0.75, accuracy: 0.0001) // 180/240
    }
}
```
- [ ] **Steps 2-5:** RED → implement `Breakdown.swift` → PASS → commit `feat(ios): project breakdown slices (port of breakdown.ts)`.

---

### Task 6: activityHeatmapRange

Add a range-scoped heatmap to the existing `Heatmap.swift` (reuse the `buildHeatmap` engine from Phase 2).

**Files:** Modify `.../Billing/Heatmap.swift`; Test `.../HeatmapRangeTests.swift`.

**Interfaces:** `func activityHeatmapRange(_ rows: [WorklogRow], from: String, to: String) -> HeatmapResult` — wraps the existing private `buildHeatmap(rows, from, to)`. If Phase 2 did not factor `buildHeatmap` out as a shared internal, refactor `activityHeatmap` to call it and add this wrapper (both must stay green).

- [ ] **Step 1: Write the failing test**
```swift
import XCTest
@testable import WatchtowerCore

final class HeatmapRangeTests: XCTestCase {
    func testRangeWindow() {
        let rows = [WorklogRow(syncId: "a", workDate: "2026-06-08", minutes: 60, reportedMinutes: nil,
            effectiveMinutes: 60, earnedAmount: nil, description: nil, projectId: 1, projectName: "P",
            projectColor: nil, projectKind: "work", isBillable: true, taskNumber: nil, taskTitle: nil, source: nil)]
        let r = activityHeatmapRange(rows, from: "2026-06-06", to: "2026-06-10")
        XCTAssertEqual(r.days.map(\.date), ["2026-06-06","2026-06-07","2026-06-08","2026-06-09","2026-06-10"])
        XCTAssertEqual(r.days.first(where:{$0.date=="2026-06-08"})?.minutes, 60)
        XCTAssertEqual(r.stats.activeDays, 1)
    }
}
```
- [ ] **Steps 2-5:** RED → implement (add wrapper, refactor if needed) → PASS (full suite green, existing heatmap tests unaffected) → commit `feat(ios): activityHeatmapRange (range-scoped heatmap)`.

---

### Task 7: ReportsFeature reducer

Owns filter state; derives range + granularity. Mirrors `useReportsFilters`.

**Files:** Create `.../Features/ReportsFeature.swift`; Test `.../ReportsFeatureTests.swift`.

**Interfaces:**
- `@Reducer struct ReportsFeature`
- `@ObservableState struct State: Equatable { var preset: Preset = .d30; var granularityChoice: Granularity? = nil; var projectId: Int? = nil; var today: String = ""; var earliest: String? = nil; // derived computed props below }`
  - computed: `var range: (from: String, to: String) { resolvePreset(preset, today: today, earliest: earliest) }`; `var granularity: Granularity { clampGranularity(granularityChoice ?? defaultGranularity(preset), from: range.from, to: range.to) }`
- `enum Action { case onAppear(earliest: String?); case presetChanged(Preset); case granularityChanged(Granularity); case projectChanged(Int?); case openProjectTapped(Int) }`
- `@Dependency(\.date.now) var now`
- Behavior: `onAppear(earliest)` — set `today` to current UTC `YYYY-MM-DD`, set `earliest`. `presetChanged(p)` — `preset = p`, `granularityChoice = nil` (revert to auto). `granularityChanged(g)` — `granularityChoice = g`. `projectChanged(id)` — `projectId = id`. `openProjectTapped` — no-op delegate (`.none`, TODO later phase).

- [ ] **Step 1: Write the failing tests**
```swift
import XCTest
import ComposableArchitecture
@testable import WatchtowerCore

@MainActor
final class ReportsFeatureTests: XCTestCase {
    func testOnAppearSeedsTodayUTCAndDerivesRange() async {
        let store = TestStore(initialState: ReportsFeature.State()) { ReportsFeature() } withDependencies: {
            $0.date.now = Date(timeIntervalSince1970: 1_780_000_000) // 2026-05-28 UTC
        }
        await store.send(.onAppear(earliest: "2025-01-01")) {
            $0.today = "2026-05-28"; $0.earliest = "2025-01-01"
        }
        XCTAssertEqual(store.state.range.to, "2026-05-28")
        XCTAssertEqual(store.state.range.from, "2026-04-29") // 30d default → today-29
        XCTAssertEqual(store.state.granularity, .day)
    }
    func testPresetResetsGranularityChoice() async {
        let store = TestStore(initialState: ReportsFeature.State(preset: .d30, granularityChoice: .week, today: "2026-05-28")) {
            ReportsFeature()
        }
        await store.send(.granularityChanged(.month)) { $0.granularityChoice = .month }
        await store.send(.presetChanged(.year)) { $0.preset = .year; $0.granularityChoice = nil }
        XCTAssertEqual(store.state.granularity, .month) // year default
    }
}
```
- [ ] **Steps 2-5:** RED → implement `ReportsFeature.swift` (use a UTC `DateFormatter`/`Calendar` for `today`, matching `EarningsFeature`) → PASS (full suite) → commit `feat(ios): ReportsFeature filter reducer`.

---

### Task 8: ReportsFilterBar (SwiftUI)

**Files:** Create `apps/iphone-native/Watchtower/Views/ReportsFilterBar.swift`.

**Interfaces:** `struct ReportsFilterBar: View { let store: StoreOf<ReportsFeature>; let projects: [ProjectRow] }`.

- [ ] **Step 1: Implement** a glass card (reuse shared `GlassCard`) with three stacked labeled fields (iPhone-narrow layout):
  - **Period** — 5-segment control (7d / 30d / Month / Year / All) → `store.send(.presetChanged(...))`; active = `store.preset`.
  - **Granularity** — 3-segment (Day / Week / Month); each option **disabled** when `clampGranularity(option, from: store.range.from, to: store.range.to) != option` (grayed, non-tappable); tap → `.granularityChanged`. Active = `store.granularity`.
  - **Project** — a `Menu`/`Picker` "All projects" + one entry per `projects` (by name) → `.projectChanged(id?)`. Active = `store.projectId`.
  English labels; `Palette` styling.
- [ ] **Step 2: Build** `cd apps/iphone-native && xcodegen generate && xcodebuild … -skipMacroValidation -skipPackagePluginValidation build` → BUILD SUCCEEDED.
- [ ] **Step 3: Commit** `feat(ios): Reports filter bar`.

---

### Task 9: TrendChartPanel (Swift Charts)

**Files:** Create `apps/iphone-native/Watchtower/Views/TrendChartPanel.swift`.

**Interfaces:** `struct TrendChartPanel: View { let series: [TrendBucket]; let markers: [RateMarker]; let from: String; let to: String; let granularity: Granularity }`.

- [ ] **Step 1: Implement** with `import Charts`:
  - Zero-fill: `let keys = enumerateBuckets(from, to, granularity)`; map each to its `TrendBucket` (0 if absent), preserving order.
  - A `Chart` of `BarMark(x: .value("bucket", key), y: .value("minutes", minutes))` per filled bucket, `.foregroundStyle(Palette.accent)`; selected bar (tap) highlighted, others `Palette.accent.opacity(0.55)`. Use `.chartXSelection(value:)` (iOS 17) or a `.chartOverlay` tap gesture to set a `@State selectedBucket`.
  - Rate markers: for each `RateMarker`, a dashed `RuleMark(x: .value("bucket", bucketKey(marker.effectiveFrom, granularity)))` in `Palette.chartCyan`, `.lineStyle(StrokeStyle(dash: [4,3]))`.
  - Above the chart: a detail line — placeholder "Tap a bar for detail" until a bar is selected, then `"{bucketLabel}: {CzFormat.hours(minutes)} · {CzFormat.czk(earnedCzk)}"`. `bucketLabel`: month→`YYYY/MM`, week→the `WNN` number, day→day-of-month.
  - Hide dense x-axis labels (`.chartXAxis(.hidden)` or show only first/last) to match the React min/max-label approach.
- [ ] **Step 2: Build** → BUILD SUCCEEDED. **Step 3: Commit** `feat(ios): Reports trend bar chart (Swift Charts)`.

---

### Task 10: ProjectDonutPanel (Swift Charts)

**Files:** Create `apps/iphone-native/Watchtower/Views/ProjectDonutPanel.swift`.

**Interfaces:** `struct ProjectDonutPanel: View { let slices: [ProjectBreakdownSlice]; let onOpenProject: (Int) -> Void }`.

- [ ] **Step 1: Implement** with `import Charts`:
  - Empty state "no data" when `slices.isEmpty`.
  - A donut via `Chart(slices) { SectorMark(angle: .value("minutes", $0.minutes), innerRadius: .ratio(0.62), angularInset: 1) .foregroundStyle(color(for:)) }`. Center overlay (`.chartBackground` or `ZStack`): `CzFormat.hours(totalMinutes)` + "total".
  - `color(for slice, index)`: `slice.color.map { Color(hex: $0) } ?? fallback[index % fallback.count]` where `fallback = [chartViolet, chartCyan, chartAmber, Color(hex:"#f87171"), Color(hex:"#34d399"), Color(hex:"#f472b6"), Color(hex:"#60a5fa"), Color(hex:"#a3e635")]` (8-color categorical, matching the React FALLBACK).
  - Legend list beside/below: per slice a color swatch, name, `CzFormat.hours(minutes)`, `"\(Int((share*100).rounded())) %"`, and a proportional bar (`max(0.02, share)` width floor). Each legend row is a `Button` → `onOpenProject(slice.projectId)`.
- [ ] **Step 2: Build** → BUILD SUCCEEDED. **Step 3: Commit** `feat(ios): Reports project donut (Swift Charts)`.

---

### Task 11: EarningsSummaryPanel + ActivityHeatmapPanel (SwiftUI)

**Files:** Create `apps/iphone-native/Watchtower/Views/EarningsSummaryPanel.swift` + `ActivityHeatmapPanel.swift`.

**Interfaces:** `struct EarningsSummaryPanel: View { let summary: EarningsSummaryResult; let onOpenProject: (Int) -> Void }`; `struct ActivityHeatmapPanel: View { let heatmap: HeatmapResult }`.

- [ ] **Step 1: Implement EarningsSummaryPanel** — 4 stat tiles (2+1+1 or 2×2 `LazyVGrid`): "Total earned" (`CzFormat.czk(totalCzk)`, accent), "Billable" (`CzFormat.hours(billableMinutes)`), "Unbillable" (`CzFormat.hours(unbillableMinutes)`), "Avg rate" (`avgEffectiveHourlyRateCzk` → `CzFormat.czk(rate)+"/h"` or "–"). Below, if `perProject` non-empty: rows (color dot, name, `CzFormat.czk(earnedCzk)`, proportional bar `earnedCzk/max(maxEarned,1)`, color `slice.color ?? chartViolet`), each a `Button` → `onOpenProject`.
- [ ] **Step 2: Implement ActivityHeatmapPanel** — reuse the Phase-2 Dashboard heatmap cell style (4 intensity buckets by `minutes/max`); a wrapping grid over `heatmap.days`; a stat strip ("{currentStreak} day streak", "longest: {longestStreak}", "active days: {activeDays}", "weekly avg: {CzFormat.hours(weeklyAvgMinutes)}"). Since iPhone has no hover, make a tapped cell reveal its `"{CzFormat.dateCz(date)}: {CzFormat.hours(minutes) or –}"` in a small label above the grid (`@State selectedDay`).
- [ ] **Step 3: Build** → BUILD SUCCEEDED. **Step 4: Commit** `feat(ios): Reports earnings-summary + activity-heatmap panels`.

---

### Task 12: ReportsView compose + wire into AppFeature/tab + sim verify

**Files:** Create `apps/iphone-native/Watchtower/Views/ReportsView.swift`; Modify `AppFeature.swift`, `AppFeatureTests.swift`, `AppShellView.swift`.

- [ ] **Step 1: Implement `ReportsView`** — `struct ReportsView: View { let billing: StoreOf<BillingFeature>; let reports: StoreOf<ReportsFeature>; let onOpenProject: (Int) -> Void }`. Reads `billing.dataset` (empty if nil). Loading gate (`billing.loadState == .loading && billing.dataset == nil` → spinner). Computes: `range = reports.range`, `g = reports.granularity`, `pid = reports.projectId`; `trend = trendSeries(worklogs, from: range.from, to: range.to, granularity: g, projectId: pid)`, `markers = rateChangeMarkers(contracts, from:…, to:…, projectId: pid)`, `earnings = earningsSummary(worklogs, from:…, to:…, projectId: pid)`, `breakdown = projectBreakdown(worklogs, from:…, to:…)` (no pid), `heat = activityHeatmapRange(worklogs, from:…, to:…)` (no pid). Compose a scroll column: `ReportsFilterBar(store: reports, projects: dataset.projects)`, then sections Trend / Earnings / By projects / Activity, wiring `onOpenProject` into the earnings + donut panels.
- [ ] **Step 2: Modify `AppFeature`** — add `var reports = ReportsFeature.State()`; `case reports(ReportsFeature.Action)`; `Scope(state: \.reports, action: \.reports) { ReportsFeature() }`. In the into-`.signedIn` transition (where billing/earnings onAppear already fire), also `.send(.reports(.onAppear(earliest: <earliest from dataset if available, else nil>)))`. Since `earliest` derives from worklogs (not known until billing loads), pass `nil` at sign-in and RE-seed: when `billing` produces a dataset (a `billing(.fetchResponse/.refreshResponse .success)` or `.cacheLoaded` that sets data), send `reports(.onAppear(earliest: <min workDate>))` to refresh the "all" bound. Simplest: in AppFeature, observe the billing dataset change and forward the earliest; if that coupling is awkward, have `ReportsFeature` accept `earliest` via a dedicated `earliestResolved(String?)` action dispatched from AppFeature when `billing.dataset` first becomes non-nil. Implement whichever is cleaner and TEST it.
- [ ] **Step 3: Extend `AppFeatureTests`** — assert reports.onAppear fires on sign-in; keep suite green.
- [ ] **Step 4: Run** `cd swift/WatchtowerCore && swift test` → all green.
- [ ] **Step 5: Modify `AppShellView`** — `.reports` tab renders `ReportsView(billing: …, reports: store.scope(state: \.reports, action: \.reports), onOpenProject: { _ in })` (drill-down destination lands in a later phase; pass a no-op or a TODO closure).
- [ ] **Step 6: Build + launch + screenshot** the Reports tab on iPhone 16e (`xcodegen generate` + build with the macro-skip flags + `simctl install`/`launch`; screenshot to scratchpad and READ it). Confirm the filter bar + panels render without crashing (empty data acceptable). Since tab-switch automation may be unavailable, at minimum confirm the app launches + the default tab renders; note the Reports-tab screenshot if reachable.
- [ ] **Step 7: Commit** `feat(ios): compose Reports view + wire into app shell`.

---

## Self-Review

**Spec coverage (Phase 3 = Reports + charts):** filter bar (period/granularity/project) → Tasks 2,7,8; trend chart → Tasks 1,3,9; earnings summary → Tasks 4,11; project donut → Tasks 5,10; activity heatmap → Tasks 6,11; compose + wire → Task 12. All six new aggregations (buckets, range helpers, trend, earnings-summary, breakdown, heatmap-range) covered by Tasks 1-6. ✓

**Placeholder scan:** Tasks 2,4,5,6 use "Steps 2-5" shorthand but each carries full Step-1 test code + exact source path + commit message. Task 12 Step 2's earliest-seeding has two spelled-out options with a "implement whichever is cleaner and TEST it" directive (a real decision left to the implementer with a test gate), not a vague placeholder.

**Type consistency:** `Granularity`/`Preset` defined in Tasks 1-2 and consumed in Trend/ReportsFeature/views. `TrendBucket`/`RateMarker`/`EarningsSummaryResult`/`ProjectBreakdownSlice` defined once and consumed by their panels + ReportsView. `ProjectEarning`/`WorklogRow`/`ContractRow`/`ProjectRow`/`HeatmapResult`/`CzFormat`/`Palette` reused from Phases 1-2 with matching signatures.

**Risk notes:** Swift Charts `SectorMark`/`BarMark`/`chartXSelection` are iOS 17 APIs (deployment target 17.0 ✓) — build-verified in Tasks 9-10. The `earliest`-seeding coupling in Task 12 is the one nontrivial integration point; flagged with a test requirement.
