# Native iPhone — Phase 4 (Records, read-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the native **Records** tab — a segmented shell over four read-only views: Worklog **List** (day-grouped), **Grid** (task×day matrix with totals/earnings footer), **Tasks** (searchable list), and **Time off** (month calendar + upcoming) — porting the record aggregations verbatim. **Read-only:** no add/edit/delete, no cell/drawer editing — those are Phase 5.

**Architecture:** New record aggregations live in `WatchtowerCore/Billing/records/` (ported verbatim from `packages/shared/src/billing/records/*` + `packages/module-timetracker/src/timeOffModel.ts`), reusing the Phase-2/3 models, `CzFormat`, `czechHolidays`, `countWorkdays`. A single `RecordsFeature` TCA reducer holds the segment selection + each sub-view's filter state (months, project filters, search query, time-off focus). `RecordsView` renders a segmented control + the active sub-view; each sub-view reads the shared `BillingFeature.dataset` and computes its data with the pure functions. Embedded in `AppFeature` via `Scope`, shown in the Records tab.

**Tech Stack:** Swift 5.10+, SwiftUI, The Composable Architecture, XCTest via TestStore, XcodeGen, Xcode 26.

## Global Constraints

- **Builds on Phases 1-3** (merged). Reuse: `WatchtowerCore` models (`WorklogRow`/`TaskRow`/`EpicRow`/`ContractRow`/`ProjectRow`/`DayOffRow`), `CzFormat`, `Palette`, `czechHolidays`/`countWorkdays` (Workdays.swift), `BillingFeature` (shared `dataset` via `billing` scope), shared `GlassCard`/`SectionHeader` (Views/Components.swift). Do NOT duplicate or regress.
- **iOS 17.0; TCA**; all I/O via `@Dependency`; reducers pure. **Read-only phase** — no mutations, no write helpers, no editing drawers/sheets. Row/cell taps are no-ops (or open nothing) this phase.
- **Verbatim ports.** Record aggregation math must match `worklog-list.ts`, `task-grid.ts`, `timeOffModel.ts`, and `workdays.ts:workdayDates` exactly. TDD vectors are the contract; fix the port against the cited source if a vector fails, never the vector.
- **Date discipline (UTC).** All date math (day-of-month, weekday, month grids, day stepping) uses a **UTC** `Calendar`/pure math — never local zone. `today`/current month computed UTC (parity with React `toISOString`).
- **cs-CZ formatting** via existing `CzFormat`. Note: the Grid's cells/footer show **bare numbers without units** (no "h"/"Kč" suffix) — use a `NumberFormatter` (cs-CZ, comma decimal, NBSP grouping for czk) OR small unit-less helpers; the section labels/legend carry the units. Cells show blank ("") when the value is 0.
- **UI English.** Labels English (List/Grid/Tasks/Time off, statuses, "no records", etc.); only cs-CZ number/date formatting + Czech holiday NAMES are Czech.
- **Board tab is OUT OF SCOPE** — the Capacitor app has a 5th "Board"(Kanban) record sub-tab; it is NOT part of this phase (design lists only list/grid/tasks/time-off).
- **Headless `xcodebuild` needs** `-skipMacroValidation -skipPackagePluginValidation`; `xcodegen generate` after adding app-target files.

---

## File Structure

```
swift/WatchtowerCore/Sources/WatchtowerCore/
├─ Billing/Workdays.swift          # MODIFY: add workdayDates(from,to,extra) + czechHolidayNames(year)->[String:String] (refactor czechHolidays Set to derive from it)
├─ Billing/records/
│  ├─ WorklogList.swift            # WorklogDay + groupWorklogsByDay
│  ├─ TaskGrid.swift               # TaskGridRow, TaskGridResult + buildTaskGrid
│  ├─ TaskGridMeta.swift           # GridDayMeta + gridDayMeta(); expectedEarnings() footer calc
│  └─ TimeOffModel.swift           # TimeOffKind/CalDay/MonthCal/UpcomingItem/TimeOffModel + buildTimeOffModel
└─ Features/
   ├─ RecordsFeature.swift         # segment + sub-view filter state
   └─ AppFeature.swift             # MODIFY: embed records via Scope; fire records.onAppear on sign-in

swift/WatchtowerCore/Tests/WatchtowerCoreTests/
├─ WorkdaysExtraTests.swift  WorklogListTests.swift  TaskGridTests.swift
├─ TaskGridMetaTests.swift  TimeOffModelTests.swift  RecordsFeatureTests.swift
├─ AppFeatureTests.swift (MODIFY)

apps/iphone-native/Watchtower/Views/
├─ RecordsView.swift               # segmented control + active sub-view; loading gate
├─ WorklogListView.swift  TaskListView.swift  TaskGridView.swift  TimeOffView.swift
└─ AppShellView.swift              # MODIFY: render RecordsView in the .records tab
```

---

### Task 1: Workdays additions — `workdayDates` + `czechHolidayNames`

`workdayDates` was skipped in Phase 2 (YAGNI) but the Grid footer needs it. `buildTimeOffModel` needs holiday **names** (Phase-2 `czechHolidays` returns only a `Set<String>` of dates).

**Files:** Modify `swift/WatchtowerCore/Sources/WatchtowerCore/Billing/Workdays.swift`; Test `.../WorkdaysExtraTests.swift`.

**Interfaces (add):**
- `func czechHolidayNames(_ year: Int) -> [String: String]` — date→English name (11 fixed + Good Friday + Easter Monday), the map `czechHolidays.ts` builds. Refactor the existing `czechHolidays(year) -> Set<String>` to `Set(czechHolidayNames(year).keys)` so `countWorkdays` stays green.
- `func workdayDates(_ from: String, _ to: String, _ extraNonWorking: Set<String>) -> [String]` — every workday (Mon–Fri minus Czech holidays minus extra) in `[from,to]` inclusive, ascending `YYYY-MM-DD`. Same predicate as `countWorkdays`. Empty if `from > to`.

- [ ] **Step 1: Write failing tests**
```swift
import XCTest
@testable import WatchtowerCore

final class WorkdaysExtraTests: XCTestCase {
    func testHolidayNames2026() {
        let h = czechHolidayNames(2026)
        XCTAssertEqual(h["2026-01-01"], "New Year / Restoration Day")
        XCTAssertEqual(h["2026-04-03"], "Good Friday")
        XCTAssertEqual(h["2026-04-06"], "Easter Monday")
        XCTAssertEqual(h["2026-12-25"], "Christmas Day")
        XCTAssertEqual(czechHolidays(2026), Set(h.keys)) // Set still derived, countWorkdays unaffected
    }
    func testWorkdayDates() {
        // 2026-01-01..2026-01-11: Jan1 holiday, weekends 3/4/10/11 → [02,05,06,07,08,09]
        XCTAssertEqual(workdayDates("2026-01-01", "2026-01-11", []),
                       ["2026-01-02","2026-01-05","2026-01-06","2026-01-07","2026-01-08","2026-01-09"])
        XCTAssertEqual(workdayDates("2026-01-01", "2026-01-11", ["2026-01-06"]).count, 5)
        XCTAssertTrue(workdayDates("2026-01-11", "2026-01-01", []).isEmpty)
    }
}
```
- [ ] **Step 2:** `swift test --filter WorkdaysExtraTests` → FAIL.
- [ ] **Step 3:** Implement — port the 11 fixed-date NAMES + Good Friday/Easter Monday from `workdays.ts:69-91` into `czechHolidayNames`; make `czechHolidays` return `Set(czechHolidayNames(year).keys)`; port `workdayDates` from `workdays.ts:151` (same UTC weekday/holiday/extra predicate as `countWorkdays`, collecting the `YYYY-MM-DD` keys).
- [ ] **Step 4:** `swift test` → all green (existing WorkdaysTests + Phase-2/3 suites unaffected; +2 new).
- [ ] **Step 5:** Commit `feat(ios): workdayDates + czechHolidayNames (Workdays additions)`.

---

### Task 2: `groupWorklogsByDay`

Port `packages/shared/src/billing/records/worklog-list.ts`.

**Files:** Create `.../Billing/records/WorklogList.swift`; Test `.../WorklogListTests.swift`.

**Interfaces:**
- `struct WorklogDay: Equatable, Sendable { let date: String; let totalMinutes: Double; let entries: [WorklogRow] }`
- `func groupWorklogsByDay(_ rows: [WorklogRow], month: String, projectId: Int?) -> [WorklogDay]`

> Filter `workDate.prefix(7)==month` + optional projectId; group by `workDate`; `totalMinutes += r.minutes` (raw minutes, not effective); `entries` in encounter order; return sorted **descending** by date (newest first).

- [ ] **Step 1: Write failing test**
```swift
import XCTest
@testable import WatchtowerCore

final class WorklogListTests: XCTestCase {
    private func wl(_ d: String, _ pid: Int, _ min: Double) -> WorklogRow {
        WorklogRow(syncId: "\(d)-\(pid)-\(min)", workDate: d, minutes: min, reportedMinutes: nil, effectiveMinutes: min,
            earnedAmount: nil, description: nil, projectId: pid, projectName: "P", projectColor: nil,
            projectKind: "work", isBillable: true, taskNumber: nil, taskTitle: nil, source: nil)
    }
    func testGroupsAndSortsDesc() {
        let rows = [wl("2026-06-01",1,60), wl("2026-06-03",1,30), wl("2026-06-03",1,30), wl("2026-05-30",1,99), wl("2026-06-02",2,45)]
        let days = groupWorklogsByDay(rows, month: "2026-06", projectId: nil)
        XCTAssertEqual(days.map(\.date), ["2026-06-03","2026-06-02","2026-06-01"]) // desc, May filtered
        XCTAssertEqual(days.first?.totalMinutes, 60) // two 30s on 06-03
        XCTAssertEqual(days.first?.entries.count, 2)
    }
    func testProjectFilter() {
        let rows = [wl("2026-06-01",1,60), wl("2026-06-01",2,45)]
        XCTAssertEqual(groupWorklogsByDay(rows, month: "2026-06", projectId: 2).first?.totalMinutes, 45)
    }
}
```
- [ ] **Steps 2-5:** RED → implement (port `worklog-list.ts`) → GREEN → commit `feat(ios): groupWorklogsByDay (port of worklog-list.ts)`.

---

### Task 3: `buildTaskGrid`

Port `packages/shared/src/billing/records/task-grid.ts` (the task×day matrix). The earnings gate is `isBillable && earnedAmount != nil` (NOT just earnedAmount).

**Files:** Create `.../Billing/records/TaskGrid.swift`; Test `.../TaskGridTests.swift`.

**Interfaces:**
- `struct TaskGridRow: Equatable, Sendable { let key: String; let projectId: Int; let taskNumber: String?; let taskTitle: String?; let projectColor: String?; let perDay: [Double]; let estimatedMinutes: Int? }`
- `struct TaskGridResult: Equatable, Sendable { let tasks: [TaskGridRow]; let dailyTotals: [Double]; let dailyEarnings: [Double]; let monthTotalMinutes: Double; let monthTotalCzk: Double; let daysInMonth: Int }`
- `func buildTaskGrid(_ rows: [WorklogRow], month: String, projectIds: [Int], estimatesByKey: [String: Int?]) -> TaskGridResult` (pass `[]` for projectIds = all; drop the legacy single `projectId` — the app only uses `projectIds`).

> `daysInMonth` = last day of `month` (UTC). Filter `workDate.prefix(7)==month` + (projectIds empty || contains r.projectId). `dayIdx = Int(workDate[8...9]) - 1`. `key = "\(projectId):\(taskNumber ?? "")"`. Per-task `perDay[dayIdx] += minutes`, `estimatedMinutes = estimatesByKey[key] ?? nil`. `dailyTotals[dayIdx] += minutes` + `monthTotalMinutes += minutes` always. `dailyEarnings[dayIdx] += earnedAmount` + `monthTotalCzk += earnedAmount` ONLY when `isBillable && earnedAmount != nil`. Sort tasks by `projectId` asc, then `taskNumber` **numeric** localizedCompare (`localizedStandardCompare`, which does numeric ordering).

- [ ] **Step 1: Write failing test**
```swift
import XCTest
@testable import WatchtowerCore

final class TaskGridTests: XCTestCase {
    private func wl(_ d: String, _ pid: Int, _ tn: String?, _ min: Double, _ earned: Double?, billable: Bool = true) -> WorklogRow {
        WorklogRow(syncId: "\(d)-\(pid)-\(tn ?? "")-\(min)", workDate: d, minutes: min, reportedMinutes: nil,
            effectiveMinutes: min, earnedAmount: earned, description: nil, projectId: pid, projectName: "P\(pid)",
            projectColor: nil, projectKind: "work", isBillable: billable, taskNumber: tn, taskTitle: "T", source: nil)
    }
    func testGrid() {
        let rows = [
            wl("2026-06-01", 1, "T-1", 60, 1000),
            wl("2026-06-02", 1, "T-1", 30, 500),
            wl("2026-06-01", 1, "T-2", 45, 300, billable: false), // non-billable: minutes count, earnings DON'T
        ]
        let g = buildTaskGrid(rows, month: "2026-06", projectIds: [], estimatesByKey: [:])
        XCTAssertEqual(g.daysInMonth, 30)
        XCTAssertEqual(g.tasks.map(\.key), ["1:T-1", "1:T-2"]) // sorted by numeric taskNumber
        XCTAssertEqual(g.tasks[0].perDay[0], 60)  // day 1
        XCTAssertEqual(g.tasks[0].perDay[1], 30)  // day 2
        XCTAssertEqual(g.dailyTotals[0], 105)     // 60 + 45
        XCTAssertEqual(g.monthTotalMinutes, 135)
        XCTAssertEqual(g.dailyEarnings[0], 1000)  // T-2's 300 excluded (non-billable)
        XCTAssertEqual(g.monthTotalCzk, 1500)     // 1000 + 500
    }
    func testProjectIdsFilter() {
        let rows = [wl("2026-06-01",1,"A",60,nil), wl("2026-06-01",2,"B",30,nil)]
        XCTAssertEqual(buildTaskGrid(rows, month: "2026-06", projectIds: [2], estimatesByKey: [:]).tasks.map(\.projectId), [2])
    }
}
```
- [ ] **Steps 2-5:** RED → implement (port `task-grid.ts`; `estimatesByKey: [String: Int?]` lookup — an absent key AND a present-but-nil value both yield `nil`) → GREEN → commit `feat(ios): buildTaskGrid (port of task-grid.ts)`.

---

### Task 4: Grid day-meta + footer expected-earnings

Port the inline `TaskGridView.tsx` day-metadata (lines 77-93) and footer capacity/expected-earnings loop (lines 95-118) as pure helpers.

**Files:** Create `.../Billing/records/TaskGridMeta.swift`; Test `.../TaskGridMetaTests.swift`.

**Interfaces:**
- `enum GridDayKind: String, Equatable, Sendable { case holiday, vacation, sick, other }`
- `struct GridDayMeta: Equatable, Sendable { let day: Int; let date: String; let isWeekend: Bool; let isToday: Bool; let kind: GridDayKind? }`
- `func gridDayMeta(month: String, daysOff: [DayOffRow], today: String) -> [GridDayMeta]` — one per day 1..daysInMonth. `isWeekend` = UTC weekday Sun/Sat. `isToday` = date==today. `kind`: holiday (from `czechHolidayNames(year)`) wins over `daysOff` kind for that date; a daysOff kind not in {vacation,sick,other} → `.other`; nil if neither.
- `struct ExpectedEarnings: Equatable, Sendable { let capacityMinutes: Int; let expectedCzk: Double }`
- `func expectedEarnings(month: String, worklogs: [WorklogRow], contracts: [ContractRow], daysOff: [DayOffRow]) -> ExpectedEarnings` — `workdays = workdayDates(monthStart, monthEnd, Set(daysOff.date))`; `capacityMinutes = workdays.count * 8 * 60`; `billableProjectIds` = distinct `projectId` of the month's worklogs where `isBillable` (and projectId != 0); for each workday × each billable project, find the contract active that day (`effectiveFrom <= date && (endDate == nil || date <= endDate)`); add `rateType=="daily" ? rateAmount : rateAmount * hoursPerDay`; `expectedCzk` = the accumulated sum rounded (`.rounded()`).

- [ ] **Step 1: Write failing tests** (a small deterministic vector)
```swift
import XCTest
@testable import WatchtowerCore

final class TaskGridMetaTests: XCTestCase {
    func testDayMeta() {
        let meta = gridDayMeta(month: "2026-01", daysOff: [DayOffRow(date: "2026-01-06", kind: "vacation", syncId: "d1")], today: "2026-01-06")
        XCTAssertEqual(meta.count, 31)
        XCTAssertEqual(meta[0].kind, .holiday)           // Jan 1 holiday
        XCTAssertTrue(meta[2].isWeekend)                 // Jan 3 Sat
        let jan6 = meta[5]
        XCTAssertEqual(jan6.kind, .vacation); XCTAssertTrue(jan6.isToday)
    }
    func testExpectedEarnings() {
        // Jan 2026: workdayDates excludes Jan1 holiday + weekends → 21 workdays (per Workdays port).
        let c = ContractRow(syncId: "c", projectId: 1, effectiveFrom: "2026-01-01", endDate: nil,
            rateType: "daily", rateAmount: 5000, hoursPerDay: 8, mdLimit: nil, contractGroupId: nil)
        let w = [WorklogRow(syncId: "w", workDate: "2026-01-05", minutes: 60, reportedMinutes: nil, effectiveMinutes: 60,
            earnedAmount: 5000, description: nil, projectId: 1, projectName: "P", projectColor: nil,
            projectKind: "work", isBillable: true, taskNumber: nil, taskTitle: nil, source: nil)]
        let e = expectedEarnings(month: "2026-01", worklogs: w, contracts: [c], daysOff: [])
        let workdays = workdayDates("2026-01-01", "2026-01-31", [])
        XCTAssertEqual(e.capacityMinutes, workdays.count * 8 * 60)
        XCTAssertEqual(e.expectedCzk, Double(workdays.count) * 5000, accuracy: 0.5) // one billable project, daily rate
    }
}
```
- [ ] **Steps 2-5:** RED → implement (port the two inline `TaskGridView.tsx` blocks) → GREEN → commit `feat(ios): task-grid day meta + expected-earnings footer`.

---

### Task 5: `buildTimeOffModel`

Port `packages/module-timetracker/src/timeOffModel.ts`.

**Files:** Create `.../Billing/records/TimeOffModel.swift`; Test `.../TimeOffModelTests.swift`.

**Interfaces:**
- `enum TimeOffKind: String, Equatable, Sendable { case vacation, sick, other, holiday }`
- `struct CalDay: Equatable, Sendable { let date: String?; let kind: TimeOffKind?; let isWeekend: Bool }`
- `struct MonthCal: Equatable, Sendable { let month: String; let label: String; let weeks: [[CalDay]] }`
- `struct UpcomingItem: Equatable, Sendable { let date: String; let kind: TimeOffKind; let note: String? }`
- `struct TimeOffModel: Equatable, Sendable { let months: [MonthCal]; let upcoming: [UpcomingItem] }`
- `func buildTimeOffModel(focusMonth: String, daysOff: [DayOffRow], today: String) -> TimeOffModel`

> `months = [addMonths(focus,-1), focus, addMonths(focus,+1)]` each via `buildMonth`. `buildMonth`: Monday-first leading null-pad `(UTCweekdayMon0 of day 1)`; per day `kind = userDaysOff[date] ?? (holidays.has(date) ? .holiday : nil)`; `isWeekend` UTC Sun/Sat; trailing null-pad to a multiple of 7; slice into 7-wide weeks; `label = CzFormat.czechMonthLabel(month)`. `normalizeKind`: raw not in {vacation,sick,other} → .other. `holidays` = union of `czechHolidayNames` for `focusYear-1, focusYear, focusYear+1`. `upcoming`: holidays (all 3 years) with `date >= today` as `{date, .holiday, name}`, THEN user daysOff with `date >= today` as `{date, kind, nil}` (user overwrites holiday for same date); sort ascending by date; **cap 30**.

- [ ] **Step 1: Write failing tests**
```swift
import XCTest
@testable import WatchtowerCore

final class TimeOffModelTests: XCTestCase {
    func testStructureAndUpcoming() {
        let daysOff = [DayOffRow(date: "2026-06-15", kind: "vacation", syncId: "v1"),
                       DayOffRow(date: "2026-07-06", kind: "weird", syncId: "w1")] // normalizes to .other
        let m = buildTimeOffModel(focusMonth: "2026-06", daysOff: daysOff, today: "2026-06-01")
        XCTAssertEqual(m.months.map(\.month), ["2026-05","2026-06","2026-07"])
        XCTAssertEqual(m.months[1].weeks.count * 7, m.months[1].weeks.flatMap { $0 }.count) // full weeks
        // 2026-06-01 is Monday → focus month first row starts with the 1st (no leading pad) — sanity: first non-nil day is "2026-06-01"
        XCTAssertEqual(m.months[1].weeks.first?.first(where: { $0.date != nil })?.date, "2026-06-01")
        // upcoming: user vacation 06-15 present, kind .vacation, note nil; weird→.other
        XCTAssertTrue(m.upcoming.contains { $0.date == "2026-06-15" && $0.kind == .vacation && $0.note == nil })
        XCTAssertTrue(m.upcoming.contains { $0.date == "2026-07-06" && $0.kind == .other })
        // a holiday >= today shows with its name as note (e.g. Cyril & Methodius 2026-07-05)
        XCTAssertTrue(m.upcoming.contains { $0.date == "2026-07-05" && $0.kind == .holiday && $0.note == "Cyril & Methodius Day" })
        XCTAssertTrue(m.upcoming.count <= 30)
        // upcoming ascending
        XCTAssertEqual(m.upcoming.map(\.date), m.upcoming.map(\.date).sorted())
    }
}
```
- [ ] **Steps 2-5:** RED → implement (port `timeOffModel.ts`, using `czechHolidayNames`, `CzFormat.czechMonthLabel`/`addMonths`) → GREEN → commit `feat(ios): buildTimeOffModel (port of timeOffModel.ts)`.

---

### Task 6: RecordsFeature reducer

Holds the segment + each sub-view's read-only filter state.

**Files:** Create `.../Features/RecordsFeature.swift`; Test `.../RecordsFeatureTests.swift`.

**Interfaces:**
- `@Reducer struct RecordsFeature`
- `enum Section: String, CaseIterable, Equatable, Sendable { case list, grid, tasks, timeOff }`
- `@ObservableState struct State: Equatable { var section: Section = .list; var worklogMonth = ""; var worklogProjectId: Int? = nil; var taskQuery = ""; var gridMonth = ""; var gridProjectIds: [Int] = []; var timeOffFocus = "" }`
- `enum Action { case onAppear; case sectionChanged(Section); case worklogMonthStepped(Int); case worklogProjectChanged(Int?); case taskQueryChanged(String); case gridMonthStepped(Int); case gridProjectToggled(Int); case timeOffFocusStepped(Int) }`
- `@Dependency(\.date.now) var now`
- Behavior: `onAppear` — if the month/focus fields are empty, seed `worklogMonth`/`gridMonth`/`timeOffFocus` to the current UTC month `YYYY-MM` (idempotent guard so re-fire doesn't reset a user's navigation). `sectionChanged` sets section. `*MonthStepped(delta)`/`timeOffFocusStepped(delta)` → `CzFormat.addMonths(field, delta)`. `worklogProjectChanged(id)` sets it. `taskQueryChanged(q)` sets it. `gridProjectToggled(id)` — toggle `id` in `gridProjectIds` (append if absent, remove if present).

- [ ] **Step 1: Write failing tests**
```swift
import XCTest
import ComposableArchitecture
@testable import WatchtowerCore

@MainActor
final class RecordsFeatureTests: XCTestCase {
    func testOnAppearSeedsMonthsUTC() async {
        let store = TestStore(initialState: RecordsFeature.State()) { RecordsFeature() } withDependencies: {
            $0.date.now = Date(timeIntervalSince1970: 1_780_000_000) // 2026-05 UTC
        }
        await store.send(.onAppear) { $0.worklogMonth = "2026-05"; $0.gridMonth = "2026-05"; $0.timeOffFocus = "2026-05" }
    }
    func testSteppingAndToggles() async {
        let store = TestStore(initialState: RecordsFeature.State(worklogMonth: "2026-06", gridMonth: "2026-06", timeOffFocus: "2026-06")) {
            RecordsFeature()
        }
        await store.send(.sectionChanged(.grid)) { $0.section = .grid }
        await store.send(.worklogMonthStepped(-1)) { $0.worklogMonth = "2026-05" }
        await store.send(.gridProjectToggled(3)) { $0.gridProjectIds = [3] }
        await store.send(.gridProjectToggled(3)) { $0.gridProjectIds = [] }
        await store.send(.taskQueryChanged("abc")) { $0.taskQuery = "abc" }
    }
}
```
- [ ] **Steps 2-5:** RED → implement (UTC month via a UTC DateFormatter like other features) → GREEN → commit `feat(ios): RecordsFeature (segment + filters)`.

---

### Task 7: WorklogListView (SwiftUI)

**Files:** Create `apps/iphone-native/Watchtower/Views/WorklogListView.swift`.

**Interfaces:** `struct WorklogListView: View { let billing: StoreOf<BillingFeature>; let records: StoreOf<RecordsFeature> }`.

- [ ] **Step 1: Implement** — read `dataset`; `days = groupWorklogsByDay(dataset.worklogs, month: records.worklogMonth, projectId: records.worklogProjectId)`.
  - Sticky month bar: `‹ CzFormat.czechMonthLabel(worklogMonth) ›` → `.worklogMonthStepped(±1)` + a "Today" button (→ set month via stepping to current; simplest: a `.worklogMonthStepped` won't jump to today — add nothing fancy, a "Today" button can send a dedicated action OR just omit if not trivial; if omitting, note it). Project filter `Menu` "All projects" + `dataset.projects` → `.worklogProjectChanged(id?)`.
  - Body (ScrollView): per `WorklogDay` a section: header (dateCz(date) left, `CzFormat.hours(totalMinutes)` right), then each entry row: color dot (projectColor), monospaced `taskNumber`, `taskTitle`/`projectName` (truncated), a source chip (`manual`→"manual"/`watchtower-auto`→"watchtower"/`jira-sync`→"jira"), right hours `CzFormat.hours(minutes)` (+ if `effectiveMinutes != minutes`, a muted "→ \(CzFormat.hours(effectiveMinutes))"). Rows are NOT tappable this phase (read-only).
  - Empty: "no records". Loading gate (`billing.loadState == .loading && billing.dataset == nil` → spinner).
  - English labels; reuse GlassCard.
- [ ] **Step 2: Build** (`xcodegen generate` + xcodebuild with macro-skip flags) → BUILD SUCCEEDED.
- [ ] **Step 3: Commit** `feat(ios): native Worklog list view (read-only)`.

---

### Task 8: TaskListView (SwiftUI)

**Files:** Create `apps/iphone-native/Watchtower/Views/TaskListView.swift`.

**Interfaces:** `struct TaskListView: View { let billing: StoreOf<BillingFeature>; let records: StoreOf<RecordsFeature> }`.

- [ ] **Step 1: Implement** — read `dataset.tasks`. Search+sort inline: `q = records.taskQuery.lowercased().trimmed`; `rows = q.isEmpty ? tasks : tasks.filter { "\($0.taskNumber ?? "") \($0.taskTitle) \($0.projectName)".lowercased().contains(q) }`; sort `projectName` localizedCompare then `taskTitle` localizedCompare.
  - Sticky search field (TextField "Search task…", bound to a local `@State` mirrored to `.taskQueryChanged`, or bind via `records.taskQuery` with `.onChange`). English placeholder.
  - Flat list of rows: color dot, monospaced `taskNumber`, `taskTitle`/"(no name)", right-aligned status chip (English `STATUS_LABEL`: open→"Open", in_progress→"In progress", to_accept→"To accept", done→"Done"; chip color: in_progress/to_accept → accent, open/done → muted).
  - Empty "no tasks"; loading gate. Read-only (no add, rows not tappable).
- [ ] **Step 2: Build** → BUILD SUCCEEDED. **Step 3: Commit** `feat(ios): native Task list view (read-only)`.

---

### Task 9: TaskGridView (SwiftUI) — the frozen-column matrix

**Files:** Create `apps/iphone-native/Watchtower/Views/TaskGridView.swift`.

**Interfaces:** `struct TaskGridView: View { let billing: StoreOf<BillingFeature>; let records: StoreOf<RecordsFeature> }`.

- [ ] **Step 1: Implement** — compute: `estimatesByKey` from `dataset.tasks` (`"\(projectId):\(taskNumber ?? "")"` → estimatedMinutes); `g = buildTaskGrid(dataset.worklogs, month: records.gridMonth, projectIds: records.gridProjectIds, estimatesByKey: estimatesByKey)`; `meta = gridDayMeta(month: records.gridMonth, daysOff: dataset.daysOff, today: <UTC today>)`; `exp = expectedEarnings(month: records.gridMonth, worklogs: dataset.worklogs, contracts: dataset.contracts, daysOff: dataset.daysOff)`.
  - Header controls (glass bar): month stepper + "Today"(optional, note if omitted) + a multi-select project `Menu` with checkbox rows over `dataset.projects` (toggle `.gridProjectToggled`), "All projects" when empty.
  - **The matrix.** Build a table with a frozen left region (task-name column + Σ column) and a horizontally-scrolling day-column region, plus a sticky header row and a pinned 2-row footer. Recommended SwiftUI structure: a vertical `ScrollView` whose content is a `Grid` (or an `HStack` of a fixed left column + a horizontal `ScrollView` of day columns). Given iPhone width, a pragmatic approach: a horizontally+vertically scrollable `Grid`/`LazyVGrid`-of-rows where the first two columns are frozen via an overlay/`.frame` fixed-left technique. IMPLEMENTER: pick the cleanest SwiftUI approach that renders correctly and builds; a perfectly-pinned iOS-native frozen header/footer is acceptable to approximate (e.g. header not sticky if a two-ScrollView sync proves excessive) — but document what you did and keep it legible. Values:
    - Left col: color dot + monospaced `taskNumber` + `taskTitle`.
    - Σ col: `CzFormat.hours(rowTotal)` (rowTotal = perDay.sum) + if `estimatedMinutes != nil` a muted "/ \(CzFormat.hours(estimatedMinutes))".
    - Day header cells: day number + DOW abbrev (Mon-first `["Mo","Tu","We","Th","Fr","Sa","Su"]`), tinted by `meta[i]` (weekend gray / holiday blue / vacation cyan / sick red), today ringed.
    - Body cells: bare hours to 1 decimal, **blank when 0**; tinted by day meta.
    - Footer row 1 "Total (h)": `hoursNum(monthTotalMinutes) / hoursNum(capacityMinutes)` + per-day `dailyTotals` (bare). Footer row 2 "Earnings": `CzFormat.czk(monthTotalCzk) / czkNum(exp.expectedCzk)` + per-day `dailyEarnings` (bare). (`hoursNum`/`czkNum` = unit-less cs-CZ numbers.)
    - Legend row: weekend/holiday/vacation/sick/today swatches (static).
  - Cells NOT tappable (read-only). Empty: "no records for this month". Loading gate.
- [ ] **Step 2: Build** → BUILD SUCCEEDED. **Step 3: Commit** `feat(ios): native Task grid view (read-only)`.

> This is the most complex view. If a fully-pinned frozen-header/footer with synchronized horizontal scroll proves too costly, a correct-but-simpler layout (e.g. the whole matrix in one 2-axis ScrollView with a non-sticky header, or day columns that scroll with a fixed left task column) is acceptable for this phase — prioritize a clean build + correct values over pixel-perfect pinning, and note the choice in the report.

---

### Task 10: TimeOffView (SwiftUI)

**Files:** Create `apps/iphone-native/Watchtower/Views/TimeOffView.swift`.

**Interfaces:** `struct TimeOffView: View { let billing: StoreOf<BillingFeature>; let records: StoreOf<RecordsFeature> }`.

- [ ] **Step 1: Implement** — `model = buildTimeOffModel(focusMonth: records.timeOffFocus, daysOff: dataset.daysOff, today: <UTC today>)`. iPhone shows only the FOCUSED month (`model.months[1]`).
  - Sticky header: `‹ Today ›` stepper (→ `.timeOffFocusStepped(±1)`) + a legend of 4 kind swatches (vacation/sick/other solid; holiday dashed outline).
  - Calendar card: month label + 7-col DOW header (`Mo Tu We Th Fr Sa Su`) + `model.months[1].weeks` grid. Day cell: number (blank if `date==nil`); background = kind color if kind ∈ {vacation,sick,other} (solid), dashed outline if `.holiday`, translucent if nil; weekend-with-no-kind → muted number.
  - "Upcoming" section: `SectionHeader("Upcoming")` + list of `model.upcoming` rows: kind-color square + `CzFormat.dateCz(date)` + `note ?? kindLabel(kind)` (kindLabel: vacation→"Vacation", sick→"Sick", other→"Other", holiday→"Holiday"). Empty: "nothing upcoming".
  - Cells NOT tappable (read-only). Loading gate.
- [ ] **Step 2: Build** → BUILD SUCCEEDED. **Step 3: Commit** `feat(ios): native Time-off view (read-only)`.

---

### Task 11: RecordsView shell + wire into AppFeature/tab + sim verify

**Files:** Create `apps/iphone-native/Watchtower/Views/RecordsView.swift`; Modify `AppFeature.swift`, `AppFeatureTests.swift`, `AppShellView.swift`.

- [ ] **Step 1: Implement `RecordsView`** — `struct RecordsView: View { let billing: StoreOf<BillingFeature>; let records: StoreOf<RecordsFeature> }`. A top segmented control (List / Grid / Tasks / Time off) bound to `records.section` (→ `.sectionChanged`), then the active sub-view (`WorklogListView`/`TaskGridView`/`TaskListView`/`TimeOffView`) all passed `billing` + `records`. Loading gate can live in each sub-view (already there) — the shell just switches.
- [ ] **Step 2: Modify `AppFeature`** — add `var records = RecordsFeature.State()`, `case records(RecordsFeature.Action)`, `Scope(state: \.records, action: \.records) { RecordsFeature() }`, and in the into-`.signedIn` transition also `.send(.records(.onAppear))`.
- [ ] **Step 3: Extend `AppFeatureTests`** — assert records.onAppear fires on sign-in; keep the suite green.
- [ ] **Step 4: Run** `cd swift/WatchtowerCore && swift test` → all green.
- [ ] **Step 5: Modify `AppShellView`** — `.records` tab renders `RecordsView(billing: store.scope(state: \.billing, action: \.billing), records: store.scope(state: \.records, action: \.records))`.
- [ ] **Step 6: Build + launch + screenshot** on iPhone 16e (`xcodegen generate`, build with macro-skip flags, `simctl install`/`launch`). Screenshot to scratchpad + READ it. Confirm the app launches + no crash; capture the Records tab if a session is present (else note the fresh-session limitation, as in prior phases).
- [ ] **Step 7: Commit** `feat(ios): compose Records view + wire into app shell`.

---

## Self-Review

**Spec coverage (Phase 4 = Records read: list/grid/tasks/time-off):** worklog list → Tasks 2,7; task grid → Tasks 3,4,9; task list → Task 8; time off → Tasks 1(names),5,10; segment shell + wiring → Tasks 6,11; `workdayDates`/`czechHolidayNames` prerequisites → Task 1. Board tab correctly excluded. All mutations (add/edit/delete, drawers, cell/day-cell taps, time-off toggles) correctly DEFERRED to Phase 5. ✓

**Placeholder scan:** Tasks 2,3,5,6 use "Steps 2-5" shorthand but carry full Step-1 test code + exact source path + commit message. Task 9 explicitly authorizes a simpler-but-correct grid layout if full pinning is too costly, with a documentation requirement — a bounded decision, not a vague placeholder. Task 7/9 note the optional "Today" button may be omitted with a note.

**Type consistency:** `WorklogDay`/`TaskGridRow`/`TaskGridResult`/`GridDayMeta`/`ExpectedEarnings`/`TimeOffModel` etc. defined once and consumed by their views + RecordsView. `RecordsFeature.State`/`Action`/`Section` names match across reducer, tests, views, and AppFeature wiring. Reused `WorklogRow`/`ContractRow`/`ProjectRow`/`DayOffRow`/`CzFormat`/`Palette`/`czechHolidays`/`czechHolidayNames`/`workdayDates` all consistent.

**Risk notes:** TaskGridView (Task 9) is the hardest SwiftUI piece (frozen columns/sticky header/pinned footer); the plan explicitly permits a correct-but-simpler layout to bound the risk. `czechHolidayNames` refactor (Task 1) must keep `countWorkdays` green (the `Set` derives from the names map). The Grid's unit-less number formatting differs from `CzFormat`'s suffixed output — flagged in Global Constraints.
