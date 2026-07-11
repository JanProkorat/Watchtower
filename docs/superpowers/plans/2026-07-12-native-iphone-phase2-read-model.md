# Native iPhone — Phase 2 (Read Model + Dashboard + Earnings) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the native read model — Supabase fetch + offline snapshot cache + the pure billing-aggregation layer — and reimplement the **Dashboard** and **Earnings** tabs (read-only) in SwiftUI, at behavioral parity with the current React views.

**Architecture:** All data + logic live in the shared `WatchtowerCore` SPM package (reused by the future native iPad). A `BillingFeature` TCA reducer owns the read model (`BillingDataset`) and the stale-while-revalidate lifecycle (load cache → render → refetch → re-cache), backed by two `@Dependency` clients: `BillingClient` (supabase-swift PostgREST fetch) and `BillingCache` (Codable snapshot on disk). The pure aggregation functions (`dashboardKpis`, `contractBurn`, `activityHeatmap`, `topProjects`, `aggregateMonthEarnings`, `trailingMonths`) and cs-CZ formatters are ported **verbatim** from `packages/shared/src/billing/*` and `packages/ui-core/*`. `BillingFeature`, `DashboardFeature` (refresh toast), and `EarningsFeature` (selected month) are embedded in the existing `AppFeature` via `Scope`; the two tab views read the shared dataset from the `BillingFeature` store and compute their projections with the pure functions.

**Tech Stack:** Swift 5.10+, SwiftUI, The Composable Architecture, supabase-swift (PostgREST), Swift Testing / XCTest via TCA `TestStore`, XcodeGen, Xcode 26.

## Global Constraints

- **Builds on Phase 1** (`feat/native-iphone-phase1`, PR #175): `WatchtowerCore` already has `Palette`+`hexRGB`, `SupabaseConfig`, `SupabaseClient` dep, `AuthFeature`, `AppFeature`. Do NOT duplicate or regress those.
- **iOS 17.0; TCA** (`@Reducer`/`@ObservableState`); all I/O via `@Dependency` with `liveValue` + `testValue`; reducers never call the SDK or disk directly.
- **Read-only phase.** No mutations, no write-side billing derivation. Worklogs are consumed with their **server-computed** `effectiveMinutes` and `earnedAmount` (PostgREST columns `effective_minutes`, `earned_amount`). Do NOT port `computeWorklogBilling` — that is Phase 5.
- **Verbatim ports.** The aggregation math and formatters must match `packages/shared/src/billing/{dashboard,contracts,heatmap,earnings,workdays}.ts` and `packages/ui-core/src/{czFormat,monthHelpers}.ts` exactly. The provided TDD test vectors are the contract: if a supplied Swift implementation fails a vector, fix the implementation against the cited JS source — never weaken the vector.
- **Date discipline** (repeats a prior production incident): all dates are plain `YYYY-MM-DD` calendar strings. Never parse them into a `Date` in the device's local zone for comparison/formatting. Month/day arithmetic uses a **UTC** `Calendar` or pure integer math. `formatDateCz` string-slices (no `Date`).
- **cs-CZ formatting is exact:** currency `142 500 Kč` (U+00A0 NBSP grouping + NBSP before `Kč`, 0 fraction digits); hours `1,5 h` (comma decimal, ≤2 fraction digits, no grouping, NBSP before `h`); date `7. 6. 2026` (no leading zeros). Set the `NumberFormatter`'s `groupingSeparator`/`decimalSeparator` **explicitly** to `"\u{00A0}"` / `","` so output does not depend on OS locale data.
- **UI English** (labels, section titles, states). Only the Czech **month names** and cs-CZ number/date formatting are Czech.
- **Headless `xcodebuild` needs** `-skipMacroValidation -skipPackagePluginValidation`. `swift test` (package) does not. Regenerate the Xcode project with `xcodegen generate` after adding app-target files.
- **Chart/accent palette:** primary accent `#7c6df0` (Phase 1). Add chart tokens used by the views' bars/heatmap/burn: `chartViolet #A78BFA`, `chartCyan #22D3EE`, `chartAmber #fbbf24`.

---

## File Structure

```
swift/WatchtowerCore/Sources/WatchtowerCore/
├─ Theme/Palette.swift                 # MODIFY: add chartViolet/chartCyan/chartAmber
├─ Formatting/CzFormat.swift           # formatCzk, formatHours, formatDateCz, czechMonthLabel, addMonths
├─ Billing/
│  ├─ BillingModels.swift              # WorklogRow, TaskRow, EpicRow, ContractRow, DayOffRow, ProjectRow, BillingDataset, ProjectEarning
│  ├─ Workdays.swift                   # czechHolidays(year), countWorkdays(from,to,extra)
│  ├─ Earnings.swift                   # aggregateMonthEarnings, trailingMonths, topProjects
│  ├─ DashboardStats.swift             # sprintWindow, dashboardKpis (+ Kpi structs)
│  ├─ Heatmap.swift                    # buildHeatmap, activityHeatmap (+ HeatmapResult)
│  ├─ ContractBurn.swift               # contractBurn (+ ContractBurn struct)
│  └─ BillingFetchMapping.swift        # PostgREST DTOs + map* → flat rows
├─ Dependencies/
│  ├─ BillingCache.swift               # @DependencyClient load/save (Codable snapshot on disk)
│  └─ BillingClient.swift              # @DependencyClient fetchBillingDataset() + paginate helper
└─ Features/
   ├─ BillingFeature.swift             # read model + SWR lifecycle
   ├─ DashboardFeature.swift           # refresh toast state
   ├─ EarningsFeature.swift            # selectedMonth + openProject delegate
   └─ AppFeature.swift                 # MODIFY: embed billing/dashboard/earnings via Scope; trigger billing.onAppear

swift/WatchtowerCore/Tests/WatchtowerCoreTests/
├─ CzFormatTests.swift  WorkdaysTests.swift  BillingModelsTests.swift
├─ EarningsTests.swift  DashboardStatsTests.swift  HeatmapTests.swift  ContractBurnTests.swift
├─ BillingCacheTests.swift  BillingFetchMappingTests.swift  PaginateTests.swift
├─ BillingFeatureTests.swift  EarningsFeatureTests.swift  DashboardFeatureTests.swift
└─ AppFeatureTests.swift            # MODIFY: cover the new child scopes

apps/iphone-native/Watchtower/Views/
├─ DashboardView.swift                # 4 sections + toast + .refreshable
├─ EarningsView.swift                 # month picker + hero + trailing bars + project list
└─ AppShellView.swift                 # MODIFY: render Dashboard/Earnings for their tabs
```

---

### Task 1: cs-CZ formatters + chart palette tokens

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerCore/Formatting/CzFormat.swift`
- Modify: `swift/WatchtowerCore/Sources/WatchtowerCore/Theme/Palette.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/CzFormatTests.swift`

**Interfaces:**
- Consumes: nothing.
- Produces: `enum CzFormat` with `static func czk(_ amount: Double) -> String`, `hours(_ minutes: Double) -> String`, `dateCz(_ iso: String) -> String`, `czechMonthLabel(_ month: String) -> String`, `addMonths(_ month: String, _ delta: Int) -> String`. Adds `Palette.chartViolet/chartCyan/chartAmber: Color`.

- [ ] **Step 1: Write the failing tests**

```swift
import XCTest
@testable import WatchtowerCore

final class CzFormatTests: XCTestCase {
    func testCzk() {
        XCTAssertEqual(CzFormat.czk(142500), "142\u{00A0}500\u{00A0}Kč")
        XCTAssertEqual(CzFormat.czk(0), "0\u{00A0}Kč")
        XCTAssertEqual(CzFormat.czk(1234.7), "1\u{00A0}235\u{00A0}Kč") // rounds to 0 frac digits
    }
    func testHours() {
        XCTAssertEqual(CzFormat.hours(90), "1,5\u{00A0}h")
        XCTAssertEqual(CzFormat.hours(60), "1\u{00A0}h")
        XCTAssertEqual(CzFormat.hours(75), "1,25\u{00A0}h")
        XCTAssertEqual(CzFormat.hours(0), "0\u{00A0}h")
    }
    func testDateCz() {
        XCTAssertEqual(CzFormat.dateCz("2026-06-07"), "7. 6. 2026")
        XCTAssertEqual(CzFormat.dateCz("2026-12-25"), "25. 12. 2026")
    }
    func testCzechMonthLabel() {
        XCTAssertEqual(CzFormat.czechMonthLabel("2026-06"), "Červen 2026")
        XCTAssertEqual(CzFormat.czechMonthLabel("2025-01"), "Leden 2025")
    }
    func testAddMonths() {
        XCTAssertEqual(CzFormat.addMonths("2026-01", -1), "2025-12")
        XCTAssertEqual(CzFormat.addMonths("2026-12", 1), "2027-01")
        XCTAssertEqual(CzFormat.addMonths("2026-06", 0), "2026-06")
        XCTAssertEqual(CzFormat.addMonths("2026-03", -5), "2025-10")
    }
}
```

- [ ] **Step 2: Run to verify FAIL**

Run: `cd swift/WatchtowerCore && swift test --filter CzFormatTests` → FAIL (`CzFormat` undefined).

- [ ] **Step 3: Implement `CzFormat.swift`**

```swift
import Foundation

public enum CzFormat {
    private static let czMonths = [
        "Leden", "Únor", "Březen", "Duben", "Květen", "Červen",
        "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec",
    ]

    private static func makeFormatter(fractionDigits: Int, grouping: Bool) -> NumberFormatter {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "cs_CZ")
        f.maximumFractionDigits = fractionDigits
        f.minimumFractionDigits = 0
        f.usesGroupingSeparator = grouping
        f.groupingSeparator = "\u{00A0}" // NBSP — match Intl cs-CZ, independent of OS locale data
        f.decimalSeparator = ","
        return f
    }

    /// `142 500 Kč` — NBSP grouping, 0 fraction digits, NBSP before Kč.
    public static func czk(_ amount: Double) -> String {
        let n = makeFormatter(fractionDigits: 0, grouping: true)
            .string(from: amount as NSNumber) ?? "0"
        return "\(n)\u{00A0}Kč"
    }

    /// `1,5 h` — minutes→hours, comma decimal, ≤2 fraction digits, no grouping.
    public static func hours(_ minutes: Double) -> String {
        let n = makeFormatter(fractionDigits: 2, grouping: false)
            .string(from: (minutes / 60) as NSNumber) ?? "0"
        return "\(n)\u{00A0}h"
    }

    /// `7. 6. 2026` — string-sliced, no Date, no leading zeros.
    public static func dateCz(_ iso: String) -> String {
        let p = iso.split(separator: "-")
        guard p.count == 3, let y = Int(p[0]), let m = Int(p[1]), let d = Int(p[2]) else { return iso }
        return "\(d). \(m). \(y)"
    }

    /// `Červen 2026` from `2026-06`.
    public static func czechMonthLabel(_ month: String) -> String {
        let p = month.split(separator: "-")
        guard p.count == 2, let y = Int(p[0]), let m = Int(p[1]), m >= 1, m <= 12 else { return month }
        return "\(czMonths[m - 1]) \(y)"
    }

    /// `2026-01` + delta months → `YYYY-MM` (pure integer math; no Date/TZ).
    public static func addMonths(_ month: String, _ delta: Int) -> String {
        let p = month.split(separator: "-")
        guard p.count == 2, let y = Int(p[0]), let m = Int(p[1]) else { return month }
        let total = y * 12 + (m - 1) + delta
        let ny = total / 12
        let nm = total % 12 + 1
        return String(format: "%04d-%02d", ny, nm)
    }
}
```

- [ ] **Step 4: Extend `Palette.swift`** — add inside `enum Palette`:

```swift
    public static let chartViolet = Color(hex: "#a78bfa")
    public static let chartCyan = Color(hex: "#22d3ee")
    public static let chartAmber = Color(hex: "#fbbf24")
```

- [ ] **Step 5: Run to verify PASS**

Run: `cd swift/WatchtowerCore && swift test --filter CzFormatTests` → PASS.
> If a `czk`/`hours` vector fails on the NBSP/separator, confirm `groupingSeparator`/`decimalSeparator` are set explicitly as above — do not change the expected strings.

- [ ] **Step 6: Commit**

```bash
git add swift/WatchtowerCore/Sources/WatchtowerCore/Formatting swift/WatchtowerCore/Sources/WatchtowerCore/Theme/Palette.swift swift/WatchtowerCore/Tests/WatchtowerCoreTests/CzFormatTests.swift
git commit -m "feat(ios): cs-CZ formatters + chart palette tokens"
```

---

### Task 2: Czech public holidays + workday counter

Port `packages/shared/src/billing/workdays.ts` (`czechHolidays`, `countWorkdays`). Needed by `contractBurn`. Do NOT port `workdayDates`/`holidaysInRange` (unused in Phase 2 — YAGNI).

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerCore/Billing/Workdays.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/WorkdaysTests.swift`

**Interfaces:**
- Produces: `func czechHolidays(_ year: Int) -> Set<String>` (dates `YYYY-MM-DD`), `func countWorkdays(_ from: String, _ to: String, _ extraNonWorking: Set<String>) -> Int` (inclusive bounds; Mon–Fri minus Czech holidays minus `extraNonWorking`; returns 0 if `from > to`).

- [ ] **Step 1: Write the failing tests**

```swift
import XCTest
@testable import WatchtowerCore

final class WorkdaysTests: XCTestCase {
    func testHolidays2026() {
        let h = czechHolidays(2026)
        // Fixed
        XCTAssertTrue(h.contains("2026-01-01"))
        XCTAssertTrue(h.contains("2026-05-01"))
        XCTAssertTrue(h.contains("2026-12-25"))
        XCTAssertTrue(h.contains("2026-12-26"))
        // Easter 2026 = Sun Apr 5 → Good Friday Apr 3, Easter Monday Apr 6
        XCTAssertTrue(h.contains("2026-04-03"))
        XCTAssertTrue(h.contains("2026-04-06"))
        XCTAssertFalse(h.contains("2026-04-05")) // Easter Sunday itself is not a listed state holiday
    }
    func testCountWorkdays() {
        // 2026-01-01..2026-01-11: Jan1=Thu(New Year holiday), 2=Fri, 3/4=weekend,
        // 5-9=Mon-Fri, 10/11=weekend. Workdays = Jan2 + Jan5..9 = 6.
        XCTAssertEqual(countWorkdays("2026-01-01", "2026-01-11", []), 6)
        // Exclude Jan 6 as a user day-off → 5.
        XCTAssertEqual(countWorkdays("2026-01-01", "2026-01-11", ["2026-01-06"]), 5)
        // Reversed range → 0.
        XCTAssertEqual(countWorkdays("2026-01-11", "2026-01-01", []), 0)
        // Single non-holiday weekday.
        XCTAssertEqual(countWorkdays("2026-01-05", "2026-01-05", []), 1)
    }
}
```

- [ ] **Step 2: Run to verify FAIL**

Run: `cd swift/WatchtowerCore && swift test --filter WorkdaysTests` → FAIL.

- [ ] **Step 3: Implement `Workdays.swift`** (port of `workdays.ts`)

```swift
import Foundation

private func pad2(_ n: Int) -> String { String(format: "%02d", n) }
private func ymd(_ y: Int, _ m: Int, _ d: Int) -> String { "\(y)-\(pad2(m))-\(pad2(d))" }

/// Anonymous Gregorian — returns (month, day) of Easter Sunday.
private func easterSunday(_ year: Int) -> (month: Int, day: Int) {
    let a = year % 19
    let b = year / 100
    let c = year % 100
    let d = b / 4
    let e = b % 4
    let f = (b + 8) / 25
    let g = (b - f + 1) / 3
    let h = (19 * a + b - d - g + 15) % 30
    let i = c / 4
    let k = c % 4
    let l = (32 + 2 * e + 2 * i - h - k) % 7
    let m = (a + 11 * h + 22 * l) / 451
    let month = (h + l - 7 * m + 114) / 31
    let day = ((h + l - 7 * m + 114) % 31) + 1
    return (month, day)
}

// UTC calendar for all date-string arithmetic (never local zone).
private let utcCal: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "UTC")!
    return c
}()

private func date(_ y: Int, _ m: Int, _ d: Int) -> Date {
    utcCal.date(from: DateComponents(year: y, month: m, day: d))!
}

private func addDaysYmd(_ y: Int, _ m: Int, _ d: Int, _ delta: Int) -> (Int, Int, Int) {
    let dt = utcCal.date(byAdding: .day, value: delta, to: date(y, m, d))!
    let c = utcCal.dateComponents([.year, .month, .day], from: dt)
    return (c.year!, c.month!, c.day!)
}

public func czechHolidays(_ year: Int) -> Set<String> {
    var set = Set<String>()
    let fixed: [(Int, Int)] = [
        (1, 1), (5, 1), (5, 8), (7, 5), (7, 6),
        (9, 28), (10, 28), (11, 17), (12, 24), (12, 25), (12, 26),
    ]
    for (m, d) in fixed { set.insert(ymd(year, m, d)) }
    let e = easterSunday(year)
    let gf = addDaysYmd(year, e.month, e.day, -2)
    let em = addDaysYmd(year, e.month, e.day, +1)
    set.insert(ymd(gf.0, gf.1, gf.2))
    set.insert(ymd(em.0, em.1, em.2))
    return set
}

/// Mon–Fri in [from, to] (inclusive) minus Czech holidays minus `extraNonWorking`.
public func countWorkdays(_ from: String, _ to: String, _ extraNonWorking: Set<String>) -> Int {
    if from > to { return 0 }
    let fp = from.split(separator: "-").compactMap { Int($0) }
    let tp = to.split(separator: "-").compactMap { Int($0) }
    guard fp.count == 3, tp.count == 3 else { return 0 }
    var cur = date(fp[0], fp[1], fp[2])
    let end = date(tp[0], tp[1], tp[2])
    var holidaysByYear: [Int: Set<String>] = [:]
    var count = 0
    while cur <= end {
        let c = utcCal.dateComponents([.year, .month, .day, .weekday], from: cur)
        // Gregorian weekday: 1=Sun ... 7=Sat. Skip weekend.
        if c.weekday != 1 && c.weekday != 7 {
            let y = c.year!
            let hol = holidaysByYear[y] ?? {
                let h = czechHolidays(y); holidaysByYear[y] = h; return h
            }()
            let key = ymd(y, c.month!, c.day!)
            if !hol.contains(key) && !extraNonWorking.contains(key) { count += 1 }
        }
        cur = utcCal.date(byAdding: .day, value: 1, to: cur)!
    }
    return count
}
```

- [ ] **Step 4: Run to verify PASS**

Run: `cd swift/WatchtowerCore && swift test --filter WorkdaysTests` → PASS. (If a vector fails, the bug is in the port — fix against `workdays.ts`, not the vector.)

- [ ] **Step 5: Commit**

```bash
git add swift/WatchtowerCore/Sources/WatchtowerCore/Billing/Workdays.swift swift/WatchtowerCore/Tests/WatchtowerCoreTests/WorkdaysTests.swift
git commit -m "feat(ios): Czech holidays + workday counter (port of workdays.ts)"
```

---

### Task 3: Domain models (Codable read-model structs)

Flat domain models mirroring `packages/shared/src/billing/types.ts`. `Codable` so the whole `BillingDataset` round-trips through the on-disk cache (Task 8). Field names are Swift camelCase; JSON cache uses the same camelCase (the cache persists our own model, not the raw PostgREST rows — DB↔model mapping happens in Task 9).

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerCore/Billing/BillingModels.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/BillingModelsTests.swift`

**Interfaces:**
- Produces the following `public struct`s, all `Equatable, Codable, Sendable`, with memberwise `public init`s:
  - `WorklogRow { syncId: String; workDate: String; minutes: Double; reportedMinutes: Double?; effectiveMinutes: Double; earnedAmount: Double?; description: String?; projectId: Int; projectName: String; projectColor: String?; projectKind: String; isBillable: Bool; taskNumber: String?; taskTitle: String?; source: String? }`
  - `TaskRow { taskId: Int; syncId: String; epicId: Int; taskNumber: String?; taskTitle: String; status: String; estimatedMinutes: Int?; description: String?; projectId: Int; projectName: String; projectColor: String?; projectKind: String; isBillable: Bool; jiraStatus: String? }`
  - `EpicRow { epicId: Int; name: String; projectId: Int; status: String }`
  - `ContractRow { syncId: String; projectId: Int; effectiveFrom: String; endDate: String?; rateType: String; rateAmount: Double; hoursPerDay: Double; mdLimit: Double?; contractGroupId: String? }`
  - `DayOffRow { date: String; kind: String; syncId: String }`
  - `ProjectRow { id: Int; name: String; color: String?; kind: String; isBillable: Bool }`
  - `BillingDataset { worklogs: [WorklogRow]; contracts: [ContractRow]; daysOff: [DayOffRow]; projects: [ProjectRow]; tasks: [TaskRow]; epics: [EpicRow]; fetchedAt: String }`
  - `ProjectEarning { projectId: Int; name: String; color: String?; minutes: Double; earnedCzk: Double }` (Equatable, Sendable; used by aggregation)

- [ ] **Step 1: Write the failing test**

```swift
import XCTest
@testable import WatchtowerCore

final class BillingModelsTests: XCTestCase {
    func testDatasetCodableRoundTrip() throws {
        let ds = BillingDataset(
            worklogs: [WorklogRow(syncId: "w1", workDate: "2026-06-07", minutes: 90, reportedMinutes: nil,
                effectiveMinutes: 90, earnedAmount: 1500, description: nil, projectId: 1, projectName: "P",
                projectColor: "#111111", projectKind: "work", isBillable: true, taskNumber: "T-1",
                taskTitle: "Task", source: "manual")],
            contracts: [], daysOff: [], projects: [ProjectRow(id: 1, name: "P", color: "#111111", kind: "work", isBillable: true)],
            tasks: [], epics: [], fetchedAt: "2026-06-07T10:00:00Z")
        let data = try JSONEncoder().encode(ds)
        let back = try JSONDecoder().decode(BillingDataset.self, from: data)
        XCTAssertEqual(back, ds)
        XCTAssertEqual(back.worklogs.first?.earnedAmount, 1500)
        XCTAssertNil(back.worklogs.first?.reportedMinutes)
    }
}
```

- [ ] **Step 2: Run to verify FAIL** — `swift test --filter BillingModelsTests` → FAIL.

- [ ] **Step 3: Implement `BillingModels.swift`** — declare the structs exactly as in **Interfaces** above, each `public struct ...: Equatable, Codable, Sendable` with a `public init(...)` assigning every field. (No `CodingKeys` needed — camelCase both sides.)

- [ ] **Step 4: Run to verify PASS** — `swift test --filter BillingModelsTests` → PASS.

- [ ] **Step 5: Commit**

```bash
git add swift/WatchtowerCore/Sources/WatchtowerCore/Billing/BillingModels.swift swift/WatchtowerCore/Tests/WatchtowerCoreTests/BillingModelsTests.swift
git commit -m "feat(ios): billing read-model Codable structs"
```

---

### Task 4: Earnings aggregation

Port `packages/shared/src/billing/earnings.ts` (`aggregateMonthEarnings`, `trailingMonths`, `topProjects`).

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerCore/Billing/Earnings.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/EarningsTests.swift`

**Interfaces:**
- Consumes: `WorklogRow`, `ProjectEarning`, `CzFormat.addMonths` (Task 1).
- Produces:
  - `func aggregateMonthEarnings(_ rows: [WorklogRow], _ month: String) -> (totalCzk: Double, perProject: [ProjectEarning])` — perProject sorted by `earnedCzk` **descending**; `totalCzk` sums only rows with non-nil `earnedAmount` in `month`.
  - `func trailingMonths(_ rows: [WorklogRow], _ endMonth: String, _ n: Int) -> [(month: String, earnedCzk: Double)]` — the `n` months ending at `endMonth` (ascending), each summing non-nil `earnedAmount`; zero-filled.
  - `func topProjects(_ rows: [WorklogRow], _ month: String, _ limit: Int) -> [ProjectEarning]` — filter `minutes > 0`, sort `minutes` desc then `name` ascending, take `limit`.

> Grouping preserves first-seen `name`/`color` per `projectId`. `inMonth(workDate, month) = String(workDate.prefix(7)) == month`. `earnedCzk` accumulates only when `earnedAmount != nil`; `minutes` always accumulates.

- [ ] **Step 1: Write the failing tests**

```swift
import XCTest
@testable import WatchtowerCore

final class EarningsTests: XCTestCase {
    private func wl(_ date: String, _ pid: Int, _ name: String, _ min: Double, _ earned: Double?) -> WorklogRow {
        WorklogRow(syncId: "\(date)-\(pid)-\(min)", workDate: date, minutes: min, reportedMinutes: nil,
            effectiveMinutes: min, earnedAmount: earned, description: nil, projectId: pid, projectName: name,
            projectColor: nil, projectKind: "work", isBillable: true, taskNumber: nil, taskTitle: nil, source: nil)
    }
    func testAggregateMonthEarnings() {
        let rows = [
            wl("2026-06-01", 1, "Alpha", 60, 1000),
            wl("2026-06-02", 1, "Alpha", 60, 1000),
            wl("2026-06-03", 2, "Beta", 120, 3000),
            wl("2026-05-30", 1, "Alpha", 60, 999),   // other month, ignored
            wl("2026-06-04", 3, "Gamma", 30, nil),   // non-billable: minutes only
        ]
        let r = aggregateMonthEarnings(rows, "2026-06")
        XCTAssertEqual(r.totalCzk, 5000)
        XCTAssertEqual(r.perProject.map(\.projectId), [2, 1, 3]) // by earnedCzk desc: 3000, 2000, 0
        XCTAssertEqual(r.perProject.first { $0.projectId == 1 }?.earnedCzk, 2000)
        XCTAssertEqual(r.perProject.first { $0.projectId == 3 }?.minutes, 30)
    }
    func testTrailingMonths() {
        let rows = [wl("2026-06-01", 1, "A", 60, 1000), wl("2026-04-01", 1, "A", 60, 500)]
        let t = trailingMonths(rows, "2026-06", 3) // Apr, May, Jun
        XCTAssertEqual(t.map(\.month), ["2026-04", "2026-05", "2026-06"])
        XCTAssertEqual(t.map(\.earnedCzk), [500, 0, 1000])
    }
    func testTopProjects() {
        let rows = [
            wl("2026-06-01", 1, "Alpha", 60, 1000),
            wl("2026-06-01", 2, "Beta", 60, 1000),  // tie on minutes → name asc
            wl("2026-06-01", 3, "Gamma", 200, 500),
        ]
        let top = topProjects(rows, "2026-06", 8)
        XCTAssertEqual(top.map(\.projectId), [3, 1, 2])
    }
}
```

- [ ] **Step 2: Run to verify FAIL** — `swift test --filter EarningsTests`.

- [ ] **Step 3: Implement `Earnings.swift`** — port `earnings.ts`. Use an ordered accumulation that preserves first-seen order for grouping, then sort per the rules. Swift's `sort` is not guaranteed stable, so encode the tie-breaks explicitly (`by: { $0.earnedCzk > $1.earnedCzk }` for perProject; `{ $0.minutes != $1.minutes ? $0.minutes > $1.minutes : $0.name < $1.name }` for topProjects). Reuse `CzFormat.addMonths` for the trailing month list.

- [ ] **Step 4: Run to verify PASS** — `swift test --filter EarningsTests`.

- [ ] **Step 5: Commit**

```bash
git add swift/WatchtowerCore/Sources/WatchtowerCore/Billing/Earnings.swift swift/WatchtowerCore/Tests/WatchtowerCoreTests/EarningsTests.swift
git commit -m "feat(ios): earnings aggregation (port of earnings.ts)"
```

---

### Task 5: Dashboard KPIs (sprint window + KPI sums)

Port `packages/shared/src/billing/dashboard.ts` (`sprintWindow`, `dashboardKpis`).

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerCore/Billing/DashboardStats.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/DashboardStatsTests.swift`

**Interfaces:**
- Produces:
  - `struct KpiAgg: Equatable, Sendable { let minutes: Double; let earnedCzk: Double }`
  - `struct SprintWindow: Equatable, Sendable { let from: String; let to: String }`
  - `struct DashboardKpis: Equatable, Sendable { let today: KpiAgg; let sprint: KpiAgg; let sprintWindow: SprintWindow; let month: KpiAgg }`
  - `func sprintWindow(_ anchor: String, startDate: String = "2026-01-05", lengthDays: Int = 14) -> SprintWindow`
  - `func dashboardKpis(_ rows: [WorklogRow], today: String) -> DashboardKpis`

> `sprintWindow`: `len = min(56, max(1, lengthDays))`; `days = floor((toUTCdays(anchor) - toUTCdays(startDate)))`; `idx = floor(days/len)` (integer floor, toward −∞ — use `Int(floor(Double))`); `from = startDate + idx*len days`; `to = from + (len-1) days`. Compute day counts with the UTC calendar helper. KPI aggs: `today` = `workDate == today`; `sprint` = `from <= workDate <= to`; `month` = `workDate.prefix(7) == today.prefix(7)`; each sums `minutes` always and `earnedAmount` only when non-nil.

- [ ] **Step 1: Write the failing tests**

```swift
import XCTest
@testable import WatchtowerCore

final class DashboardStatsTests: XCTestCase {
    func testSprintWindow() {
        // anchor == startDate → idx 0 → [start, start+13]
        XCTAssertEqual(sprintWindow("2026-01-05"), SprintWindow(from: "2026-01-05", to: "2026-01-18"))
        // 14 days later → idx 1 → [start+14, start+27]
        XCTAssertEqual(sprintWindow("2026-01-19"), SprintWindow(from: "2026-01-19", to: "2026-02-01"))
    }
    func testDashboardKpis() {
        func wl(_ d: String, _ min: Double, _ earned: Double?) -> WorklogRow {
            WorklogRow(syncId: d, workDate: d, minutes: min, reportedMinutes: nil, effectiveMinutes: min,
                earnedAmount: earned, description: nil, projectId: 1, projectName: "P", projectColor: nil,
                projectKind: "work", isBillable: true, taskNumber: nil, taskTitle: nil, source: nil)
        }
        let rows = [wl("2026-01-19", 60, 1000), wl("2026-01-20", 30, 500), wl("2026-01-05", 90, 900)]
        let k = dashboardKpis(rows, today: "2026-01-19")
        XCTAssertEqual(k.today, KpiAgg(minutes: 60, earnedCzk: 1000))
        XCTAssertEqual(k.sprintWindow, SprintWindow(from: "2026-01-19", to: "2026-02-01"))
        XCTAssertEqual(k.sprint, KpiAgg(minutes: 90, earnedCzk: 1500)) // Jan19 + Jan20
        XCTAssertEqual(k.month, KpiAgg(minutes: 180, earnedCzk: 2400)) // all three in Jan
    }
}
```

- [ ] **Step 2–5:** Run FAIL → implement `DashboardStats.swift` (use a `daysSinceEpochUTC(_ ymd:)` helper built on the UTC calendar, or reuse a shared helper from `Workdays.swift` if you expose one — keep it internal) → run PASS → commit `feat(ios): dashboard KPI aggregation (port of dashboard.ts)`.

---

### Task 6: Activity heatmap

Port `packages/shared/src/billing/heatmap.ts` (`buildHeatmap`, `activityHeatmap`).

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerCore/Billing/Heatmap.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/HeatmapTests.swift`

**Interfaces:**
- Produces:
  - `struct HeatmapDay: Equatable, Sendable { let date: String; let minutes: Double }`
  - `struct HeatmapStats: Equatable, Sendable { let currentStreak: Int; let longestStreak: Int; let activeDays: Int; let weeklyAvgMinutes: Int; let busiestDay: String? }`
  - `struct HeatmapResult: Equatable, Sendable { let days: [HeatmapDay]; let stats: HeatmapStats }`
  - `func activityHeatmap(_ rows: [WorklogRow], today: String, windowDays: Int = 30) -> HeatmapResult`

> Window = `[today - (windowDays-1), today]` inclusive, zero-filled. `minutes` per day sums raw `minutes` (NOT effectiveMinutes). `activeDays` = days with `minutes>0`. `weeklyAvgMinutes = round(totalMinutes/windowDays * 7)`. `currentStreak` walks back from `today` while `minutes>0`. `longestStreak` = longest `minutes>0` run. `busiestDay` = first date achieving the running max (first-wins on ties; strictly-greater comparison), nil if none.

- [ ] **Step 1: Write the failing test**

```swift
import XCTest
@testable import WatchtowerCore

final class HeatmapTests: XCTestCase {
    private func wl(_ d: String, _ min: Double) -> WorklogRow {
        WorklogRow(syncId: d, workDate: d, minutes: min, reportedMinutes: nil, effectiveMinutes: min,
            earnedAmount: nil, description: nil, projectId: 1, projectName: "P", projectColor: nil,
            projectKind: "work", isBillable: true, taskNumber: nil, taskTitle: nil, source: nil)
    }
    func testHeatmapWindowAndStats() {
        // 5-day window ending 2026-06-10 → [06-06 .. 06-10]
        let rows = [wl("2026-06-08", 60), wl("2026-06-09", 120), wl("2026-06-10", 30), wl("2026-06-01", 999)]
        let r = activityHeatmap(rows, today: "2026-06-10", windowDays: 5)
        XCTAssertEqual(r.days.map(\.date), ["2026-06-06","2026-06-07","2026-06-08","2026-06-09","2026-06-10"])
        XCTAssertEqual(r.days.map(\.minutes), [0,0,60,120,30])
        XCTAssertEqual(r.stats.activeDays, 3)
        XCTAssertEqual(r.stats.currentStreak, 3)   // 08,09,10 all >0
        XCTAssertEqual(r.stats.longestStreak, 3)
        XCTAssertEqual(r.stats.busiestDay, "2026-06-09")
        XCTAssertEqual(r.stats.weeklyAvgMinutes, Int((210.0/5*7).rounded())) // 294
    }
}
```

- [ ] **Step 2–5:** Run FAIL → implement `Heatmap.swift` (UTC day stepping; `Int(x.rounded())` for the weekly avg, matching JS `Math.round` for positive values) → run PASS → commit `feat(ios): activity heatmap (port of heatmap.ts)`.

---

### Task 7: Contract burn / MD projection

Port `packages/shared/src/billing/contracts.ts` (`contractBurn` + `round2`/`addDay`/`minDate`). Returns one entry per active member project (group dedup is the caller's job — Task 14).

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerCore/Billing/ContractBurn.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/ContractBurnTests.swift`

**Interfaces:**
- Consumes: `ContractRow`, `WorklogRow`, `DayOffRow`, `ProjectRow`, `countWorkdays` (Task 2).
- Produces:
  - `struct ContractBurn: Equatable, Sendable { let projectId: Int; let projectName: String; let projectColor: String?; let mdsUsed: Double; let mdLimit: Double?; let mdsRemaining: Double?; let projectedMds: Double?; let workdaysRemaining: Int?; let totalWorkdays: Int?; let endDate: String?; let contractGroupId: String? }`
  - `func contractBurn(_ contracts: [ContractRow], _ rows: [WorklogRow], _ daysOff: [DayOffRow], _ projects: [ProjectRow], today: String) -> [ContractBurn]`

> Active = `today >= effectiveFrom && (endDate == nil || today <= endDate)`. `periodEnd = endDate ?? today`. Pooled `memberIds` = all contracts sharing `contractGroupId` (else `[projectId]`). `minutesLogged` = Σ `effectiveMinutes` of worklogs whose `projectId ∈ memberIds`, `effectiveFrom <= workDate <= periodEnd`, `projectKind == "work"`. `mdsUsed = round2(minutesLogged/60/hoursPerDay)`; `round2(n) = (n*100).rounded()/100`. `mdsRemaining = mdLimit==nil ? nil : round2(mdLimit - mdsUsed)`. `elapsedWorkdays = countWorkdays(effectiveFrom, min(today,periodEnd), extraNonWorking)` where `extraNonWorking` = all `daysOff.date`. `totalWorkdays = endDate==nil ? nil : countWorkdays(effectiveFrom, endDate, extra)`. `workdaysRemaining` = (endDate && today<=endDate) → `countWorkdays(addDay(today), endDate, extra)`; else endDate → 0; else nil. `projectedMds = (totalWorkdays != nil && elapsedWorkdays>0) ? round2(mdsUsed/elapsedWorkdays * totalWorkdays) : nil`. `addDay(date)` = next calendar day (UTC). `projectName`/`projectColor` from the `projects` list by `projectId` (default `""`/`nil`).

- [ ] **Step 1: Write the failing test**

```swift
import XCTest
@testable import WatchtowerCore

final class ContractBurnTests: XCTestCase {
    func testSoloHourlyBurnWithLimit() {
        let c = ContractRow(syncId: "c1", projectId: 1, effectiveFrom: "2026-01-01", endDate: "2026-01-31",
            rateType: "hourly", rateAmount: 1000, hoursPerDay: 8, mdLimit: 20, contractGroupId: nil)
        func wl(_ d: String, _ eff: Double) -> WorklogRow {
            WorklogRow(syncId: d, workDate: d, minutes: eff, reportedMinutes: nil, effectiveMinutes: eff,
                earnedAmount: nil, description: nil, projectId: 1, projectName: "P", projectColor: "#111111",
                projectKind: "work", isBillable: true, taskNumber: nil, taskTitle: nil, source: nil)
        }
        // 2 workdays * 8h = 16h = 960 min logged → 960/60/8 = 2.00 MD used.
        let rows = [wl("2026-01-05", 480), wl("2026-01-06", 480)]
        let projects = [ProjectRow(id: 1, name: "P", color: "#111111", kind: "work", isBillable: true)]
        let burns = contractBurn([c], rows, [], projects, today: "2026-01-15")
        XCTAssertEqual(burns.count, 1)
        let b = burns[0]
        XCTAssertEqual(b.mdsUsed, 2.0, accuracy: 0.0001)
        XCTAssertEqual(b.mdsRemaining, 18.0, accuracy: 0.0001)
        XCTAssertEqual(b.totalWorkdays, 21) // Jan 2026 workdays excl New Year holiday + weekends
        XCTAssertNotNil(b.projectedMds)
        XCTAssertEqual(b.endDate, "2026-01-31")
    }
    func testInactiveContractExcluded() {
        let c = ContractRow(syncId: "c1", projectId: 1, effectiveFrom: "2026-02-01", endDate: nil,
            rateType: "hourly", rateAmount: 1000, hoursPerDay: 8, mdLimit: nil, contractGroupId: nil)
        XCTAssertTrue(contractBurn([c], [], [], [], today: "2026-01-15").isEmpty)
    }
}
```

> The tester should confirm `totalWorkdays` for Jan 2026 independently: Jan has 31 days; weekdays minus New Year (Jan 1 Thu holiday). Compute with `countWorkdays("2026-01-01","2026-01-31", [])` — assert whatever that returns and use the same figure here (they must agree; if 21 is wrong for the ported calendar, both this vector and `countWorkdays` reflect the same truth).

- [ ] **Step 2–5:** Run FAIL → implement `ContractBurn.swift` → run PASS → commit `feat(ios): contract burn / MD projection (port of contracts.ts)`.

---

### Task 8: BillingCache dependency (Codable snapshot on disk)

Mirror `billingCache.ts` cache: a single JSON blob of the whole `BillingDataset`, loaded on launch and overwritten after each successful fetch. Backed by a file in Application Support; no TTL.

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerCore/Dependencies/BillingCache.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/BillingCacheTests.swift`

**Interfaces:**
- Produces:
  - `@DependencyClient struct BillingCache: Sendable { var load: @Sendable () async -> BillingDataset? = { nil }; var save: @Sendable (BillingDataset) async -> Void }`
  - `extension BillingCache: DependencyKey` with `liveValue` (reads/writes `<AppSupport>/billing-cache.json` via `FileManager`, JSON-encoded; `load` returns `nil` on missing/corrupt) and `testValue = BillingCache()`.
  - `extension DependencyValues { var billingCache: BillingCache { get set } }`
  - A testable pure core: `enum BillingCacheCodec { static func decode(_ data: Data) -> BillingDataset?; static func encode(_ ds: BillingDataset) -> Data }` — `decode` returns `nil` on any error (mirrors `loadCache`'s shape-guard returning null).

- [ ] **Step 1: Write the failing tests**

```swift
import XCTest
@testable import WatchtowerCore

final class BillingCacheTests: XCTestCase {
    private func sample() -> BillingDataset {
        BillingDataset(worklogs: [], contracts: [], daysOff: [], projects: [], tasks: [], epics: [],
                       fetchedAt: "2026-06-07T10:00:00Z")
    }
    func testCodecRoundTrip() {
        let data = BillingCacheCodec.encode(sample())
        XCTAssertEqual(BillingCacheCodec.decode(data), sample())
    }
    func testDecodeGarbageReturnsNil() {
        XCTAssertNil(BillingCacheCodec.decode(Data("not json".utf8)))
        XCTAssertNil(BillingCacheCodec.decode(Data("{}".utf8))) // missing required fields
    }
}
```

- [ ] **Step 2–5:** Run FAIL → implement `BillingCache.swift` (codec + live file store; the live value isn't unit-tested — the codec is). Run `swift test --filter BillingCacheTests` PASS, then `swift build` to confirm the live store compiles. Commit `feat(ios): BillingCache Codable snapshot dependency`.

---

### Task 9: PostgREST DTOs + mapping to flat rows

Mirror `billingCache.ts` mappers. PostgREST returns nested joins (`worklogs → tasks → epics → projects`); decode into DTOs, then flatten to the Task 3 models — including the JS defaults: worklog `projectId` 0 / `projectName` "" when no task chain; task `estimatedMinutes` falls back to `round(jiraEstimateSecs/60)` when the manual estimate is null.

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerCore/Billing/BillingFetchMapping.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/BillingFetchMappingTests.swift`

**Interfaces:**
- Produces internal `Decodable` DTOs matching the PostgREST JSON (snake_case via `CodingKeys` or `.convertFromSnakeCase`) for each of the six selects, plus:
  - `enum BillingMapper { static func worklog(_ dto: WorklogDTO) -> WorklogRow; static func task(_ dto: TaskDTO) -> TaskRow; static func epic(_ dto: EpicDTO) -> EpicRow; static func contract(_ dto: ContractDTO) -> ContractRow; static func dayOff(_ dto: DayOffDTO) -> DayOffRow; static func project(_ dto: ProjectDTO) -> ProjectRow }`

> Worklog select nests `tasks(number,title,epics(projects(id,name,color,kind,is_billable)))`. The flattened `projectId/projectName/projectColor/projectKind/isBillable` come from `dto.tasks?.epics?.projects`; when the chain is nil → `projectId=0, projectName="", projectColor=nil, projectKind="", isBillable=false`; `taskNumber=dto.tasks?.number`, `taskTitle=dto.tasks?.title`. Task select nests `epics(projects(...))`; same project-chain flattening. `estimatedMinutes = dto.estimatedMinutes ?? (dto.jiraEstimateSecs.map { Int((Double($0)/60).rounded()) })`.

- [ ] **Step 1: Write the failing tests** — decode a hand-written JSON string for one worklog with a full task chain and one with `tasks: null`; assert the flattened fields. Decode a task with `estimated_minutes: null, jira_estimate_secs: 5400` → `estimatedMinutes == 90`.

```swift
import XCTest
@testable import WatchtowerCore

final class BillingFetchMappingTests: XCTestCase {
    func testWorklogWithTaskChain() throws {
        let json = """
        {"sync_id":"w1","work_date":"2026-06-07","minutes":90,"effective_minutes":90,
         "earned_amount":1500,"reported_minutes":null,"description":null,"source":"manual",
         "tasks":{"number":"T-1","title":"Task","epics":{"projects":{"id":7,"name":"Proj","color":"#abc","kind":"work","is_billable":true}}}}
        """
        let dto = try JSONDecoder().decode(WorklogDTO.self, from: Data(json.utf8))
        let row = BillingMapper.worklog(dto)
        XCTAssertEqual(row.projectId, 7)
        XCTAssertEqual(row.projectName, "Proj")
        XCTAssertEqual(row.isBillable, true)
        XCTAssertEqual(row.taskNumber, "T-1")
        XCTAssertEqual(row.effectiveMinutes, 90)
    }
    func testWorklogWithoutTask() throws {
        let json = """
        {"sync_id":"w2","work_date":"2026-06-07","minutes":30,"effective_minutes":30,
         "earned_amount":null,"reported_minutes":null,"description":null,"source":null,"tasks":null}
        """
        let dto = try JSONDecoder().decode(WorklogDTO.self, from: Data(json.utf8))
        let row = BillingMapper.worklog(dto)
        XCTAssertEqual(row.projectId, 0)
        XCTAssertEqual(row.projectName, "")
        XCTAssertNil(row.earnedAmount)
    }
    func testTaskEstimateFallback() throws {
        let json = """
        {"id":1,"sync_id":"t1","epic_id":2,"number":"T-1","title":"T","status":"open",
         "estimated_minutes":null,"jira_estimate_secs":5400,"jira_status":null,"description":null,
         "epics":{"projects":{"id":7,"name":"P","color":null,"kind":"work","is_billable":true}}}
        """
        let dto = try JSONDecoder().decode(TaskDTO.self, from: Data(json.utf8))
        XCTAssertEqual(BillingMapper.task(dto).estimatedMinutes, 90)
    }
}
```

- [ ] **Step 2–5:** Run FAIL → implement `BillingFetchMapping.swift` (DTOs + mappers). Prefer explicit `CodingKeys` for clarity. Run PASS → commit `feat(ios): PostgREST DTOs + flat-row mapping`.

---

### Task 10: Pagination helper + BillingClient fetch dependency

Port `paginate.ts` (`fetchAllPaged`, page size 1000) as a pure, testable helper, then the `BillingClient` dependency that fetches all six tables via supabase-swift PostgREST and assembles a `BillingDataset`.

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerCore/Dependencies/BillingClient.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/PaginateTests.swift`

**Interfaces:**
- Produces:
  - `func fetchAllPaged<T>(pageSize: Int = 1000, _ page: (_ from: Int, _ to: Int) async throws -> [T]) async rethrows -> [T]` — loops `from = 0, +pageSize`; requests inclusive range `[from, from+pageSize-1]`; stops when a page returns `< pageSize` rows; concatenates.
  - `@DependencyClient struct BillingClient: Sendable { var fetchBillingDataset: @Sendable () async throws -> BillingDataset }`
  - `extension BillingClient: DependencyKey` with `liveValue` (uses the same lazily-built Supabase client seam as Phase 1's `SupabaseClient` — build it from `SupabaseConfig.load(from: Bundle.main.infoDictionary ?? [:])`; issue the six selects with the exact column strings from the plan appendix, `.is("deleted_at", value: nil)`, `.order("sync_id"/"id")`, paginate worklogs/tasks/epics via `fetchAllPaged`, decode DTOs, map via `BillingMapper`, stamp `fetchedAt` with an injected clock or `ISO8601` of now) and `testValue = BillingClient()`.
  - `extension DependencyValues { var billingClient: BillingClient { get set } }`

> Exact selects (from the appendix): worklogs `"sync_id,work_date,minutes,effective_minutes,earned_amount,reported_minutes,description,source,tasks(number,title,epics(projects(id,name,color,kind,is_billable)))"` ordered by `sync_id`; tasks `"id,sync_id,epic_id,number,title,status,estimated_minutes,jira_estimate_secs,jira_status,description,epics(projects(id,name,color,kind,is_billable))"` ordered by `id`; epics `"id,name,project_id,status"` ordered by `id`; contracts `"sync_id,project_id,effective_from,end_date,rate_type,rate_amount,hours_per_day,md_limit,contract_group_id"`; days_off `"date,kind,sync_id"`; projects `"id,name,color,kind,is_billable"`. All filter `.is("deleted_at", value: nil)`. Worklogs/tasks/epics are paginated; the other three are single fetches.

- [ ] **Step 1: Write the failing test (pagination logic only — the live fetch is build-verified)**

```swift
import XCTest
@testable import WatchtowerCore

final class PaginateTests: XCTestCase {
    func testStopsWhenPartialPage() async throws {
        // 2500 items, page size 1000 → pages of 1000,1000,500 then stop.
        let all = Array(0..<2500)
        var calls: [(Int, Int)] = []
        let out = try await fetchAllPaged(pageSize: 1000) { from, to in
            calls.append((from, to))
            guard from < all.count else { return [] }
            return Array(all[from...min(to, all.count - 1)])
        }
        XCTAssertEqual(out, all)
        XCTAssertEqual(calls, [(0, 999), (1000, 1999), (2000, 2999)]) // last page 500<1000 → stop
    }
    func testEmpty() async throws {
        let out: [Int] = try await fetchAllPaged(pageSize: 1000) { _, _ in [] }
        XCTAssertEqual(out, [])
    }
}
```

- [ ] **Step 2–5:** Run FAIL → implement `BillingClient.swift` (helper + live fetch). Run `swift test --filter PaginateTests` PASS, then `swift build` to verify the supabase-swift PostgREST query/decoder API compiles (adapt select/filter/range/`execute().value` decoding to the resolved SDK — the PostgREST builder decodes directly into `[DTO]` via `.execute().value`). Commit `feat(ios): paginate helper + BillingClient PostgREST fetch`.

---

### Task 11: BillingFeature reducer (read model + SWR lifecycle)

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerCore/Features/BillingFeature.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/BillingFeatureTests.swift`

**Interfaces:**
- Consumes: `BillingCache`, `BillingClient` deps; `BillingDataset`.
- Produces:
  - `@Reducer struct BillingFeature`
  - `enum LoadState: Equatable, Sendable { case loading, fresh, cached, offline }`
  - `@ObservableState struct State: Equatable { var dataset: BillingDataset?; var loadState: LoadState = .loading; var lastUpdated: String?; var showRefreshToast: Bool = false; init() {} }`
  - `enum Action { case onAppear; case cacheLoaded(BillingDataset?); case refreshRequested; case fetchResponse(Result<BillingDataset, ...>); case toastExpired }` (use a `BillingError: Error, Equatable` mapped from any throw, or `Result<BillingDataset, BillingError>`).
- Behavior (mirror `useBilling`):
  - `onAppear`: run cache load → `cacheLoaded`, then always fire a fetch → `fetchResponse` (non-toast).
  - `cacheLoaded(ds)`: if `ds != nil` set `dataset = ds`, `loadState = .cached`, `lastUpdated = ds.fetchedAt`; if nil, no-op (stay `.loading`).
  - `refreshRequested`: fire a fetch whose success sets the toast (manual refresh). Keep existing `dataset` visible meanwhile.
  - `fetchResponse(.success(ds))`: save to cache (effect), set `dataset = ds`, `loadState = .fresh`, `lastUpdated = ds.fetchedAt`; if this fetch was a manual refresh, `showRefreshToast = true` + schedule `toastExpired` after 2.2s.
  - `fetchResponse(.failure)`: if `dataset != nil` keep it and set `loadState = .cached`; else `loadState = .offline`, `dataset = nil`, `lastUpdated = nil`.
  - `toastExpired`: `showRefreshToast = false`.
- Use a way to distinguish onAppear-fetch vs manual-refresh (e.g. two response actions `fetchResponse` / `refreshResponse`, or a `Bool` payload). Prefer two actions: `fetchResponse(Result)` (onAppear) and `refreshResponse(Result)` (manual, sets toast) sharing a private helper.

- [ ] **Step 1: Write the failing tests**

```swift
import XCTest
import ComposableArchitecture
@testable import WatchtowerCore

@MainActor
final class BillingFeatureTests: XCTestCase {
    private func ds(_ stamp: String) -> BillingDataset {
        BillingDataset(worklogs: [], contracts: [], daysOff: [], projects: [], tasks: [], epics: [], fetchedAt: stamp)
    }
    func testOnAppearCacheHitThenFreshFetch() async {
        let saved = LockIsolated<BillingDataset?>(nil)
        let store = TestStore(initialState: BillingFeature.State()) { BillingFeature() } withDependencies: {
            $0.billingCache.load = { self.ds("cached") }
            $0.billingCache.save = { saved.setValue($0) }
            $0.billingClient.fetchBillingDataset = { self.ds("fresh") }
        }
        store.exhaustivity = .off(showSkippedAssertions: false)
        await store.send(.onAppear)
        await store.receive(\.cacheLoaded) {
            $0.dataset = self.ds("cached"); $0.loadState = .cached; $0.lastUpdated = "cached"
        }
        await store.receive(\.fetchResponse.success) {
            $0.dataset = self.ds("fresh"); $0.loadState = .fresh; $0.lastUpdated = "fresh"
        }
        XCTAssertEqual(saved.value, ds("fresh"))
    }
    func testFetchErrorWithCacheStaysCached() async {
        struct Boom: Error {}
        let store = TestStore(initialState: BillingFeature.State(/* seed cached */)) { BillingFeature() } withDependencies: {
            $0.billingClient.fetchBillingDataset = { throw Boom() }
        }
        // seed a dataset first via cacheLoaded, then a failing fetch keeps it and marks .cached
        // (write this precisely against the resolved Action shape).
    }
    func testRefreshShowsToastThenExpires() async {
        // refreshRequested → refreshResponse.success → showRefreshToast=true → toastExpired → false
    }
}
```

- [ ] **Step 2–5:** Run FAIL → implement `BillingFeature.swift` (use a `@Dependency(\.continuousClock)` for the 2.2s toast delay so `TestStore` can advance it deterministically). Complete the second/third tests to actually drive the offline-fallback and toast paths (don't leave them as comments — fill them in with concrete assertions). Run `swift test --filter BillingFeatureTests` PASS → commit `feat(ios): BillingFeature read model + SWR lifecycle`.

---

### Task 12: EarningsFeature reducer (selected month)

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerCore/Features/EarningsFeature.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/EarningsFeatureTests.swift`

**Interfaces:**
- Produces:
  - `@Reducer struct EarningsFeature`
  - `@ObservableState struct State: Equatable { var selectedMonth: String; init(selectedMonth: String = "") { self.selectedMonth = selectedMonth } }`
  - `enum Action { case onAppear; case monthStepped(Int); case openProjectTapped(Int) }`
  - `@Dependency(\.date.now) var now`
  - Behavior: `onAppear` — if `selectedMonth` is empty, set it to the current month (`YYYY-MM`) derived from `now` in **UTC** (to match the React `toISOString().slice(0,7)`); use a UTC `DateFormatter`/`Calendar`. `monthStepped(delta)` → `selectedMonth = CzFormat.addMonths(selectedMonth, delta)`. `openProjectTapped(id)` — delegate/no-op in Phase 2 (drill-down lands in a later phase): return `.none` (the value is surfaced to the view/parent later; for now it just marks intent). Add a `// TODO(phase-4/5): route to ProjectDetail` comment.

- [ ] **Step 1: Write the failing tests**

```swift
import XCTest
import ComposableArchitecture
@testable import WatchtowerCore

@MainActor
final class EarningsFeatureTests: XCTestCase {
    func testOnAppearSeedsCurrentMonthUTC() async {
        let store = TestStore(initialState: EarningsFeature.State()) { EarningsFeature() } withDependencies: {
            $0.date.now = Date(timeIntervalSince1970: 1_780_000_000) // 2026-05-28T... UTC
        }
        await store.send(.onAppear) { $0.selectedMonth = "2026-05" }
    }
    func testMonthStepping() async {
        let store = TestStore(initialState: EarningsFeature.State(selectedMonth: "2026-01")) { EarningsFeature() }
        await store.send(.monthStepped(-1)) { $0.selectedMonth = "2025-12" }
        await store.send(.monthStepped(1)) { $0.selectedMonth = "2026-01" }
    }
}
```

> Verify the epoch→month: `1_780_000_000` s = 2026-05-28 (UTC). Confirm with the ported formatter and set the expected month to whatever that instant's UTC month is; keep vector and code in agreement.

- [ ] **Step 2–5:** Run FAIL → implement `EarningsFeature.swift` → run PASS → commit `feat(ios): EarningsFeature selected-month reducer`.

---

### Task 13: DashboardFeature reducer (refresh toast)

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerCore/Features/DashboardFeature.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/DashboardFeatureTests.swift`

**Interfaces:**
- Produces:
  - `@Reducer struct DashboardFeature`
  - `@ObservableState struct State: Equatable { var showToast: Bool = false; init() {} }`
  - `enum Action { case refreshFinished; case toastExpired }`
  - `@Dependency(\.continuousClock) var clock`
  - Behavior: `refreshFinished` → `showToast = true` + `.run { try await clock.sleep(for: .seconds(2.2)); await send(.toastExpired) }` (cancellable id to coalesce rapid refreshes). `toastExpired` → `showToast = false`.

> The Dashboard *view* owns the pull-to-refresh: `.refreshable { await billingStore.send(.refreshRequested).finish(); dashboardStore.send(.refreshFinished) }`. The toast lives here; the billing refresh itself is `BillingFeature`'s concern.

- [ ] **Step 1: Write the failing test**

```swift
import XCTest
import ComposableArchitecture
@testable import WatchtowerCore

@MainActor
final class DashboardFeatureTests: XCTestCase {
    func testRefreshShowsThenHidesToast() async {
        let clock = TestClock()
        let store = TestStore(initialState: DashboardFeature.State()) { DashboardFeature() } withDependencies: {
            $0.continuousClock = clock
        }
        await store.send(.refreshFinished) { $0.showToast = true }
        await clock.advance(by: .seconds(2.2))
        await store.receive(\.toastExpired) { $0.showToast = false }
    }
}
```

- [ ] **Step 2–5:** Run FAIL → implement → run PASS → commit `feat(ios): DashboardFeature refresh toast`.

---

### Task 14: DashboardView (SwiftUI)

Rebuild `DashboardView.tsx` natively. Read-only; reads the shared dataset from the `BillingFeature` store, computes projections with the pure functions, dedupes contract burns by `contractGroupId`.

**Files:**
- Create: `apps/iphone-native/Watchtower/Views/DashboardView.swift`

**Interfaces:**
- Consumes: `StoreOf<BillingFeature>`, `StoreOf<DashboardFeature>`, all Task 4–7 aggregations, `CzFormat`, `Palette`.
- Produces: `struct DashboardView: View { let billing: StoreOf<BillingFeature>; let dashboard: StoreOf<DashboardFeature> }`.

- [ ] **Step 1: Implement `DashboardView.swift`**

Structure (top→bottom in a `ScrollView` with `.refreshable`):
- Compute inside the view from `billing.dataset ?? empty`: `today` = current UTC date `YYYY-MM-DD`; `kpis = dashboardKpis(worklogs, today:)`; `burnsRaw = contractBurn(...)` then **dedupe by `contractGroupId`** (keep first per non-nil group; solo `nil`-group entries always kept); `top = topProjects(worklogs, month, 8)`; `heat = activityHeatmap(worklogs, today:)`; `monthHasData = worklogs.contains { $0.workDate.prefix(7) == month }`.
- **Section "Worked"** — header + 3 KPI glass tiles (Today / Sprint / This month): label (uppercase, `Palette.textMuted`), `CzFormat.hours(minutes)` (22pt bold), `CzFormat.czk(earnedCzk)` (accent, 13pt). Always 2+1 wrap layout (iPhone is always narrow).
- **Section "Active contracts"** (only if any burns): a `BurnCard` per deduped burn — color dot + name (fallback "(no name)") + optional "{workdaysRemaining} wd left"; then a burn bar: no limit → "{mdsUsed, 2dp} MD (no limit)"; with limit → "{used} / {limit} MD" left + "est: {projectedMds} MD" right (amber if `projectedMds > limit`); 8pt track with `Palette.chartViolet` fill to `min(1, used/limit)`, amber overlay `used→proj` if overrun, else a 2pt `Palette.chartCyan` tick at `proj/limit`.
- **Section "Top projects — {month, "/" separator}"** (only if `monthHasData`): if `top` empty → muted "no data"; else a glass card of rows (rank, color dot, name, `hours`, `czk` if >0) each with a 4pt proportional bar (`minutes / max(topMax,1)`), colored by project color (fallback `chartViolet`). If `!monthHasData` → centered card "no data for this month".
- **Section "Activity (30 days)"** — glass card: a 7-column heatmap grid (square cells, 4 intensity buckets by `minutes/maxMinutes`: 0 → faint white; <25% dim+low-opacity; <50% dim; <75% chartViolet@0.8; else chartViolet), each cell `.help`/accessibility label `"{dateCz}: {hours or –}"`; then a stat strip: "{currentStreak} day streak", "longest: {longestStreak}", "active days: {activeDays}", "weekly avg: {hours(weeklyAvgMinutes)}", and if non-nil "busiest: {dateCz(busiestDay)}".
- **Toast** — when `dashboard.showToast`: a bottom-center glass pill, green dot + "Dashboard updated", overlaid.
- `.refreshable { await billing.send(.refreshRequested).finish(); dashboard.send(.refreshFinished) }`.
- **Loading gate:** if `billing.loadState == .loading && billing.dataset == nil` → centered spinner + "Loading…". (Offline with no data falls through to an all-empty dashboard, matching React — acceptable.)

Use `Palette` colors; build small private subviews (`KpiTile`, `BurnCard`, `TopRow`, `HeatCell`) to keep the file focused.

- [ ] **Step 2: Build**

Run: `cd apps/iphone-native && xcodegen generate && xcodebuild -project Watchtower.xcodeproj -scheme Watchtower -destination 'generic/platform=iOS Simulator' -skipMacroValidation -skipPackagePluginValidation build` → BUILD SUCCEEDED.

- [ ] **Step 3: Commit** — `git add apps/iphone-native/Watchtower/Views/DashboardView.swift && git commit -m "feat(ios): native Dashboard view"`

---

### Task 15: EarningsView (SwiftUI)

Rebuild `EarningsMonthView.tsx`. Reads shared dataset + `EarningsFeature.selectedMonth`; per-project rows drill down via `openProjectTapped`.

**Files:**
- Create: `apps/iphone-native/Watchtower/Views/EarningsView.swift`

**Interfaces:**
- Consumes: `StoreOf<BillingFeature>`, `StoreOf<EarningsFeature>`, `aggregateMonthEarnings`, `trailingMonths`, `CzFormat`, `Palette`.
- Produces: `struct EarningsView: View { let billing: StoreOf<BillingFeature>; let earnings: StoreOf<EarningsFeature> }`.

- [ ] **Step 1: Implement `EarningsView.swift`**

Structure:
- **MonthPicker** (glass card, always visible): `‹` → `earnings.send(.monthStepped(-1))`, center `CzFormat.czechMonthLabel(selectedMonth)` (bold), `›` → `.monthStepped(1)`.
- Compute `agg = aggregateMonthEarnings(worklogs, selectedMonth)`, `trailing = trailingMonths(worklogs, selectedMonth, 8)`.
- **Hero total** glass card: uppercase "Total earnings", then `CzFormat.czk(agg.totalCzk)` big (40pt, monospaced, `Palette.chartViolet`).
- **Section "Trend (8 months)"** — glass card with a bar row: one bar per trailing month, height `% = max(earnedCzk / max(maxCzk,1), 0.03) * 100`, color `chartViolet` if `month == selectedMonth` else `chartViolet.opacity(0.53)`; 3-letter Czech caption below (`["led","úno","bře","dub","kvě","čer","čvc","srp","zář","říj","lis","pro"][monthIndex]`, bold+violet if selected); accessibility label `"{czechMonthLabel}: {czk}"`.
- **Section "Projects"** — if `agg.perProject` empty → centered card "No earnings this month"; else a glass card of rows: color dot, name (fallback "(no name)"), `CzFormat.hours(minutes)` (muted), `CzFormat.czk(earnedCzk)` (bold violet, right), a `chevron.right`; below each row a 3pt proportional bar (`earnedCzk / max(maxEarned,1)`), project color. Whole row is a `Button` → `earnings.send(.openProjectTapped(projectId))`.
- **Loading gate:** `billing.loadState == .loading && billing.dataset == nil` → MonthPicker + spinner + "Loading…". No pull-to-refresh here (matches React).

- [ ] **Step 2: Build** — same xcodebuild command → BUILD SUCCEEDED.

- [ ] **Step 3: Commit** — `git commit -m "feat(ios): native Earnings month view"`

---

### Task 16: Wire features into AppFeature + tabs; build & simulator verify

Embed the three new features in `AppFeature`, trigger the billing load, and render the two real views in their tabs.

**Files:**
- Modify: `swift/WatchtowerCore/Sources/WatchtowerCore/Features/AppFeature.swift`
- Modify: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/AppFeatureTests.swift`
- Modify: `apps/iphone-native/Watchtower/Views/AppShellView.swift`

**Interfaces:**
- `AppFeature.State` gains: `var billing = BillingFeature.State()`, `var dashboard = DashboardFeature.State()`, `var earnings = EarningsFeature.State()`.
- `AppFeature.Action` gains: `case billing(BillingFeature.Action)`, `case dashboard(DashboardFeature.Action)`, `case earnings(EarningsFeature.Action)`.
- `AppFeature.body` gains `Scope(state: \.billing, action: \.billing) { BillingFeature() }` (+ dashboard, earnings), and on `.onAppear` also returns effects sending `.billing(.onAppear)` and `.earnings(.onAppear)` (merge with the existing auth-gate effect).

- [ ] **Step 1: Modify `AppFeature.swift`** — add the child states/actions/scopes; in the existing `.onAppear` handler, `.merge` the current auth-event effect with `.send(.billing(.onAppear))` and `.send(.earnings(.onAppear))`.

- [ ] **Step 2: Extend `AppFeatureTests.swift`** — add a test that `.onAppear` triggers `.billing(.onAppear)` (use `.off` exhaustivity + assert the billing load path runs, stubbing `billingCache.load`/`billingClient`). Keep existing tests green.

- [ ] **Step 3: Run package tests** — `cd swift/WatchtowerCore && swift test` → all green (Phase 1's + all Phase 2 suites).

- [ ] **Step 4: Modify `AppShellView.swift`** — for the `.dashboard` tab render `DashboardView(billing: store.scope(state: \.billing, action: \.billing), dashboard: store.scope(state: \.dashboard, action: \.dashboard))`; for `.earnings` render `EarningsView(billing: ..., earnings: store.scope(state: \.earnings, action: \.earnings))`. Reports/Records keep the Phase-1 placeholder.

- [ ] **Step 5: Build + launch + screenshot**

```bash
cd apps/iphone-native
xcodegen generate
DEST='platform=iOS Simulator,name=iPhone 16e'
xcodebuild -project Watchtower.xcodeproj -scheme Watchtower -destination "$DEST" -skipMacroValidation -skipPackagePluginValidation build
APP="$(xcodebuild -project Watchtower.xcodeproj -scheme Watchtower -showBuildSettings -destination "$DEST" | awk '/ CODESIGNING_FOLDER_PATH/{ $1=""; print substr($0,2) }')"
xcrun simctl install booted "$APP"; xcrun simctl launch booted cz.greencode.watchtower.ios
```
Verify (screenshot): the app launches; if a Supabase session exists it shows the Dashboard tab with data (or an empty/loading dashboard offline); switching to Earnings shows the month picker + (empty) sections; no crash on either tab. Full authenticated data verification needs real credentials (carried over from Phase 1) — capture what is observable and note the rest.

- [ ] **Step 6: Commit** — `git add -A swift/WatchtowerCore/Sources/WatchtowerCore/Features/AppFeature.swift swift/WatchtowerCore/Tests/WatchtowerCoreTests/AppFeatureTests.swift apps/iphone-native/Watchtower/Views/AppShellView.swift && git commit -m "feat(ios): wire billing/dashboard/earnings features into app shell"`

---

## Self-Review

**Spec coverage (design §4/§5/§7 Phase 2 scope = read model + cache + Dashboard + Earnings read):**
- Read model (models + fetch + mapping) → Tasks 3, 9, 10. ✓
- SWR + offline snapshot cache → Tasks 8, 11 (mirrors `useBilling`). ✓
- cs-CZ formatting → Task 1. ✓
- Dashboard (KPIs, contract burn, top projects, heatmap, pull-to-refresh toast) → Tasks 5, 6, 7, 13, 14. ✓
- Earnings (month nav, total, trailing bars, project list + drill-down intent) → Tasks 4, 12, 15. ✓
- Czech public holidays for burn workdays → Task 2. ✓
- Integration into the tab shell → Task 16. ✓
- Correctly deferred: write-side derivation (`computeWorklogBilling`), mutations, project drill-down destination, Reports/Records tabs, charts library — later phases. ✓

**Placeholder scan:** Tasks 5, 6, 7, 8, 9, 12 use the "Steps 2–5" shorthand but each names the exact file, the exact source to port, the exact commit message, and carries full test code in Step 1 — no vague requirements. Task 11's test stub explicitly instructs filling in the two commented tests with concrete assertions (not left as placeholders). Views (14, 15) give full structural specs; SwiftUI views are build-verified, not unit-tested.

**Type consistency:** `WorklogRow`/`ContractRow`/etc. field names are used identically across Tasks 3–15. Aggregation return types (`DashboardKpis`, `HeatmapResult`, `ContractBurn`, `ProjectEarning`, `(totalCzk,perProject)`) match between their defining task and the views. `BillingFeature`/`EarningsFeature`/`DashboardFeature` state+action names match between reducer tasks (11–13), the AppFeature wiring (16), and the views (14–15). `CzFormat` method names are stable across all consumers.

**Risk notes:** supabase-swift PostgREST query/decoding API is build-verified in Task 10 (adapt to the resolved SDK). The `today` value uses UTC to match the React `toISOString().slice(...)` semantics — flagged in Global Constraints and Tasks 12/14. `NumberFormatter` separators are pinned explicitly to avoid OS-locale drift.
