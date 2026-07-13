# Native iPhone Phase 5 — Mutations + ProjectDetail + Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first write surface to the native SwiftUI/TCA iPhone app — client-derived-billing write-through CRUD for worklogs, tasks, contracts, and time-off — plus the ProjectDetail earnings drill-down and the read-only Board (Kanban) view.

**Architecture:** All billing math and write-row builders are ported to Swift as **pure, host-testable functions** under `WatchtowerCore/Billing/` (bit-for-bit copies of `packages/shared/src/billing/*` and `packages/data-supabase/src/billingWrites.ts`). The single `BillingDataset` snapshot is migrated from `BillingFeature`-owned state to **`@Shared(.inMemory("billingDataset"))`** so every editor feature can read and optimistically mutate the same in-memory dataset without store threading. Writes go through a new `BillingWriteClient` dependency (Supabase-direct, online-only); each editor feature does snapshot → optimistic `$dataset.withLock` patch → `await` the write → **rollback on error**. Navigation is introduced for the first time: `@Presents` sheets for editors, `NavigationStack` + `.navigationDestination(item:)` for the ProjectDetail push.

**Tech Stack:** Swift 5.10, SwiftUI, The Composable Architecture 1.15+ (`@Reducer`, `@Presents`, `@Shared`, `TestStore`), supabase-swift 2.0+, XcodeGen, XCTest (macOS host).

## Global Constraints

- **UI text is English.** New user-facing strings and error messages are English (the TS layer uses Czech literals like `'Uložení selhalo'` — do NOT copy those; write `"Save failed"` etc.). Date/number/currency formatting stays cs-CZ via the existing `CzFormat` helpers.
- **Dates are opaque `String` (`"yyyy-MM-dd"`) end-to-end in the write path.** Never construct a `Date` from a date-kind field and reformat it in the device's local calendar — that reintroduces the fixed sync DATE-shift off-by-one. The one place a `Date` is built (`previousDay`) MUST use a UTC calendar.
- **All deletes are soft deletes** (`deleted_at` + `updated_at` stamped via UPDATE), never a hard DELETE.
- **Client derives billing itself:** every worklog written or optimistically patched carries client-computed `effectiveMinutes`/`earnedAmount` from `computeWorklogBilling`; never trust a stale server value across an edit.
- **Online-direct writes only:** editing is gated on `canEdit(loadState) == (loadState == .fresh)`. No offline write queue — `.cached`/`.offline`/`.loading` are read-only.
- **Bit-for-bit billing:** `computeWorklogBilling`, `resolveContract`, `parseMinutes`, `contractsOverlap`, `previousDay` must match the TS source's arithmetic and edge cases exactly (see per-task code).
- **Bundle id** `cz.greencode.watchtower.ios`. Package platforms `.iOS(.v17), .macOS(.v13)`.
- **Build flags:** `xcodebuild` on the generated project MUST pass `-skipMacroValidation -skipPackagePluginValidation`. `swift test` from `swift/WatchtowerCore/` does not. Re-run `xcodegen generate` in `apps/iphone-native/` after adding any new `Views/*.swift` file.
- **Host-test constraint:** `swift test` runs on macOS — no `UIColor`. Test pure logic and reducers only; keep color/`Color` out of tests.
- **Source of truth for ports (read before porting each):**
  - `packages/shared/src/billing/worklogBilling.ts`, `parseMinutes.ts`, `contracts-overlap.ts`, `date-helpers.ts`, `board/board.ts`
  - `packages/data-supabase/src/billingWrites.ts`, `useWorklogMutations.ts`, `useTaskMutations.ts`, `useContractMutations.ts`, `useDaysOffMutations.ts`
  - `packages/ui-core/src/projectDetailHelpers.ts`
- **Deferred Phase-7 polish — NOT in scope here.** Do NOT DRY the duplicated empty-`BillingDataset` fallback / UTC-day helpers across existing files, do not tokenize track colors, do not do a global a11y sweep. The ONE in-path exception: add an `.accessibilityLabel` to each NEW glyph-only control this phase creates (the `+`/stepper/close buttons on new views). Do not touch existing controls.

---

## Milestone 1 — Pure write-layer logic (host-testable, no UI)

All Milestone 1 code lives in `swift/WatchtowerCore/Sources/WatchtowerCore/Billing/` with tests in `swift/WatchtowerCore/Tests/WatchtowerCoreTests/`. Run tests with `cd swift/WatchtowerCore && swift test --filter <TestClass>`.

### Task 1: Worklog billing computation

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerCore/Billing/WorklogBilling.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/WorklogBillingTests.swift`

**Interfaces:**
- Produces: `struct ContractLite { let effectiveFrom: String; let rateType: String; let rateAmount: Double; let hoursPerDay: Double }`, `struct WorklogBilling: Equatable { let effectiveMinutes: Double; let resolvedRate: Double?; let earnedAmount: Double? }`, `func resolveContract(workDate: String, contracts: [ContractLite]) -> ContractLite?`, `func computeWorklogBilling(minutes: Double, reportedMinutes: Double?, workDate: String, contracts: [ContractLite]) -> WorklogBilling`

- [ ] **Step 1: Write the failing tests**

```swift
import XCTest
@testable import WatchtowerCore

final class WorklogBillingTests: XCTestCase {
    private let c100 = ContractLite(effectiveFrom: "2026-01-01", rateType: "hourly", rateAmount: 100, hoursPerDay: 8)
    private let c200 = ContractLite(effectiveFrom: "2026-06-01", rateType: "hourly", rateAmount: 200, hoursPerDay: 8)

    func testEffectiveMinutesPrefersReportedIncludingZero() {
        XCTAssertEqual(computeWorklogBilling(minutes: 90, reportedMinutes: 0, workDate: "2026-03-01", contracts: [c100]).effectiveMinutes, 0)
        XCTAssertEqual(computeWorklogBilling(minutes: 90, reportedMinutes: nil, workDate: "2026-03-01", contracts: [c100]).effectiveMinutes, 90)
    }

    func testResolveContractInclusiveLowerBoundary() {
        XCTAssertEqual(resolveContract(workDate: "2026-05-31", contracts: [c100, c200])?.rateAmount, 100)
        XCTAssertEqual(resolveContract(workDate: "2026-06-01", contracts: [c100, c200])?.rateAmount, 200)
    }

    func testResolveContractFirstEncounteredWinsOnTie() {
        let a = ContractLite(effectiveFrom: "2026-01-01", rateType: "hourly", rateAmount: 1, hoursPerDay: 8)
        let b = ContractLite(effectiveFrom: "2026-01-01", rateType: "hourly", rateAmount: 2, hoursPerDay: 8)
        XCTAssertEqual(resolveContract(workDate: "2026-02-01", contracts: [a, b])?.rateAmount, 1)
    }

    func testNoContractReturnsNilRateAndAmount() {
        let r = computeWorklogBilling(minutes: 60, reportedMinutes: nil, workDate: "2025-01-01", contracts: [c100])
        XCTAssertEqual(r.effectiveMinutes, 60)
        XCTAssertNil(r.resolvedRate)
        XCTAssertNil(r.earnedAmount)
    }

    func testHourlyEarned() {
        let r = computeWorklogBilling(minutes: 90, reportedMinutes: nil, workDate: "2026-03-01", contracts: [c100])
        XCTAssertEqual(r.earnedAmount, 150)
        XCTAssertEqual(r.resolvedRate, 100)
    }

    func testDailyEarned() {
        let daily = ContractLite(effectiveFrom: "2026-01-01", rateType: "daily", rateAmount: 4000, hoursPerDay: 8)
        let r = computeWorklogBilling(minutes: 240, reportedMinutes: nil, workDate: "2026-03-01", contracts: [daily])
        XCTAssertEqual(r.earnedAmount, 2000)
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd swift/WatchtowerCore && swift test --filter WorklogBillingTests`
Expected: FAIL — `cannot find 'computeWorklogBilling' in scope`.

- [ ] **Step 3: Write the implementation**

```swift
import Foundation

public struct ContractLite: Equatable, Sendable {
    public let effectiveFrom: String
    public let rateType: String
    public let rateAmount: Double
    public let hoursPerDay: Double
    public init(effectiveFrom: String, rateType: String, rateAmount: Double, hoursPerDay: Double) {
        self.effectiveFrom = effectiveFrom; self.rateType = rateType
        self.rateAmount = rateAmount; self.hoursPerDay = hoursPerDay
    }
}

public struct WorklogBilling: Equatable, Sendable {
    public let effectiveMinutes: Double
    public let resolvedRate: Double?
    public let earnedAmount: Double?
}

/// Latest effectiveFrom <= workDate, lexicographic string compare (timezone-safe).
/// Tie on equal effectiveFrom: first encountered in array order wins (strict `>`).
public func resolveContract(workDate: String, contracts: [ContractLite]) -> ContractLite? {
    var best: ContractLite?
    for c in contracts where c.effectiveFrom <= workDate {
        if best == nil || c.effectiveFrom > best!.effectiveFrom { best = c }
    }
    return best
}

public func computeWorklogBilling(minutes: Double, reportedMinutes: Double?, workDate: String, contracts: [ContractLite]) -> WorklogBilling {
    let effectiveMinutes = reportedMinutes ?? minutes
    guard let c = resolveContract(workDate: workDate, contracts: contracts) else {
        return WorklogBilling(effectiveMinutes: effectiveMinutes, resolvedRate: nil, earnedAmount: nil)
    }
    let earned = c.rateType == "hourly"
        ? (effectiveMinutes * c.rateAmount) / 60.0
        : (effectiveMinutes / 60.0 / c.hoursPerDay) * c.rateAmount
    return WorklogBilling(effectiveMinutes: effectiveMinutes, resolvedRate: c.rateAmount, earnedAmount: earned)
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd swift/WatchtowerCore && swift test --filter WorklogBillingTests`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add swift/WatchtowerCore/Sources/WatchtowerCore/Billing/WorklogBilling.swift swift/WatchtowerCore/Tests/WatchtowerCoreTests/WorklogBillingTests.swift
git commit -m "feat(iphone-native): port computeWorklogBilling + resolveContract (Phase 5)"
```

---

### Task 2: parseMinutes

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerCore/Billing/ParseMinutes.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/ParseMinutesTests.swift`

**Interfaces:**
- Produces: `func parseMinutes(_ input: String) -> Int?` (nil where the TS returns `NaN`).

- [ ] **Step 1: Write the failing tests**

```swift
import XCTest
@testable import WatchtowerCore

final class ParseMinutesTests: XCTestCase {
    func testDecimalHours() {
        XCTAssertEqual(parseMinutes("1"), 60)
        XCTAssertEqual(parseMinutes("1.5"), 90)
        XCTAssertEqual(parseMinutes("1,5"), 90)   // comma normalized
    }
    func testDecimalRounds() { XCTAssertEqual(parseMinutes("1.501"), 90) } // 90.06 -> round -> 90
    func testColonForm() {
        XCTAssertEqual(parseMinutes("1:30"), 90)
        XCTAssertEqual(parseMinutes("1:5"), 65)
        XCTAssertEqual(parseMinutes("1:90"), 150) // not clamped to 59
    }
    func testHmForm() {
        XCTAssertEqual(parseMinutes("2h"), 120)
        XCTAssertEqual(parseMinutes("45m"), 45)
        XCTAssertEqual(parseMinutes("1h30m"), 90)
        XCTAssertEqual(parseMinutes("1.5h"), 90)
        XCTAssertEqual(parseMinutes("1h 30m"), 90)
    }
    func testGarbageAndEmpty() {
        XCTAssertNil(parseMinutes(""))
        XCTAssertNil(parseMinutes("   "))
        XCTAssertNil(parseMinutes("abc"))
        XCTAssertNil(parseMinutes("h"))
        XCTAssertNil(parseMinutes("-1"))
    }
}
```

- [ ] **Step 2: Run to verify failure** — `swift test --filter ParseMinutesTests` → FAIL.

- [ ] **Step 3: Write the implementation** (mirror the TS grammar + priority order exactly)

```swift
import Foundation

/// Ported from packages/shared/src/billing/parseMinutes.ts — returns nil where TS returns NaN.
public func parseMinutes(_ input: String) -> Int? {
    // Trim, lowercase, replace FIRST comma with dot (String.replace w/o /g).
    var trimmed = input.trimmingCharacters(in: .whitespaces).lowercased()
    if let comma = trimmed.firstIndex(of: ",") { trimmed.replaceSubrange(comma...comma, with: ".") }
    if trimmed.isEmpty { return nil }

    // 1) pure decimal hours: ^\d+(\.\d+)?$
    if matches(trimmed, #"^\d+(\.\d+)?$"#), let hours = Double(trimmed) {
        return Int((hours * 60).rounded())
    }
    // 2) H:MM colon form: ^(\d+):(\d{1,2})$  (minutes NOT clamped)
    if let g = capture(trimmed, #"^(\d+):(\d{1,2})$"#), let h = Int(g[0]), let m = Int(g[1]) {
        return h * 60 + m
    }
    // 3) [Nh][Mm] form: ^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$ — at least one group present
    if let g = optionalCapture(trimmed, #"^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$"#) {
        let hStr = g[0], mStr = g[1]
        if !hStr.isEmpty || !mStr.isEmpty {
            let hoursPart = Int(((Double(hStr) ?? 0) * 60).rounded())
            let minsPart = Int(mStr) ?? 0
            return hoursPart + minsPart
        }
    }
    return nil
}

private func matches(_ s: String, _ pattern: String) -> Bool {
    s.range(of: pattern, options: .regularExpression) != nil
}
// Returns the capture groups (empty string for a group that didn't match), or nil if no overall match.
private func capture(_ s: String, _ pattern: String) -> [String]? { runRegex(s, pattern, groups: 2, requireAll: true) }
private func optionalCapture(_ s: String, _ pattern: String) -> [String]? { runRegex(s, pattern, groups: 2, requireAll: false) }

private func runRegex(_ s: String, _ pattern: String, groups: Int, requireAll: Bool) -> [String]? {
    guard let re = try? NSRegularExpression(pattern: pattern) else { return nil }
    let range = NSRange(s.startIndex..., in: s)
    guard let m = re.firstMatch(in: s, range: range) else { return nil }
    var out: [String] = []
    for i in 1...groups {
        let r = m.range(at: i)
        if r.location == NSNotFound {
            if requireAll { return nil }
            out.append("")
        } else if let sr = Range(r, in: s) {
            out.append(String(s[sr]))
        } else { out.append("") }
    }
    return out
}
```

> Note on rounding: Swift's `Double.rounded()` is round-half-away-from-zero, matching JS `Math.round` for the positive values `parseMinutes` handles (negatives are rejected by the regexes upstream).

- [ ] **Step 4: Run to verify pass** — `swift test --filter ParseMinutesTests` → PASS.

- [ ] **Step 5: Commit**

```bash
git add swift/WatchtowerCore/Sources/WatchtowerCore/Billing/ParseMinutes.swift swift/WatchtowerCore/Tests/WatchtowerCoreTests/ParseMinutesTests.swift
git commit -m "feat(iphone-native): port parseMinutes grammar (Phase 5)"
```

---

### Task 3: Contract overlap + previousDay (UTC)

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerCore/Billing/ContractRules.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/ContractRulesTests.swift`

**Interfaces:**
- Produces: `let openEndedSentinel = "9999-12-31"`, `func contractsOverlap(_ aFrom: String, _ aEnd: String?, _ bFrom: String, _ bEnd: String?) -> Bool`, `func previousDay(_ date: String) -> String`

- [ ] **Step 1: Write the failing tests**

```swift
import XCTest
@testable import WatchtowerCore

final class ContractRulesTests: XCTestCase {
    func testOverlapOpenEnded() {
        XCTAssertTrue(contractsOverlap("2026-01-01", nil, "2026-06-01", nil))
        XCTAssertTrue(contractsOverlap("2026-01-01", "2026-12-31", "2026-06-01", nil))
    }
    func testNoOverlapAdjacent() {
        XCTAssertFalse(contractsOverlap("2026-01-01", "2026-05-31", "2026-06-01", nil))
    }
    func testOverlapTouching() {
        XCTAssertTrue(contractsOverlap("2026-01-01", "2026-06-01", "2026-06-01", nil))
    }
    func testPreviousDayCrossesMonthBoundaryInUTC() {
        XCTAssertEqual(previousDay("2026-06-01"), "2026-05-31")
        XCTAssertEqual(previousDay("2026-01-01"), "2025-12-31")
        XCTAssertEqual(previousDay("2026-03-01"), "2026-02-28")
    }
}
```

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Write the implementation**

```swift
import Foundation

public let openEndedSentinel = "9999-12-31"

/// Ported from packages/shared/src/billing/contracts-overlap.ts
public func contractsOverlap(_ aFrom: String, _ aEnd: String?, _ bFrom: String, _ bEnd: String?) -> Bool {
    aFrom <= (bEnd ?? openEndedSentinel) && (aEnd ?? openEndedSentinel) >= bFrom
}

/// Ported from packages/shared/src/billing/date-helpers.ts — MUST use a UTC calendar.
public func previousDay(_ date: String) -> String {
    let parts = date.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3 else { return date }
    var utc = Calendar(identifier: .gregorian)
    utc.timeZone = TimeZone(identifier: "UTC")!
    var comps = DateComponents()
    comps.year = parts[0]; comps.month = parts[1]; comps.day = parts[2]
    guard let d = utc.date(from: comps),
          let prev = utc.date(byAdding: .day, value: -1, to: d) else { return date }
    let out = utc.dateComponents([.year, .month, .day], from: prev)
    return String(format: "%04d-%02d-%02d", out.year!, out.month!, out.day!)
}
```

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add swift/WatchtowerCore/Sources/WatchtowerCore/Billing/ContractRules.swift swift/WatchtowerCore/Tests/WatchtowerCoreTests/ContractRulesTests.swift
git commit -m "feat(iphone-native): port contractsOverlap + previousDay UTC (Phase 5)"
```

---

### Task 4: Edit gates

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerCore/Billing/EditGates.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/EditGatesTests.swift`

**Interfaces:**
- Consumes: `LoadState` enum (already defined in `Features/BillingFeature.swift` as `.loading/.fresh/.cached/.offline`). Move nothing; import it.
- Produces: `func canEdit(_ state: LoadState) -> Bool`, `func canEditTask(_ status: String) -> Bool`.

> Note: `canEditTask` gates task update/delete ONLY — do NOT call it from worklog mutations. This replicates the TS asymmetry faithfully (documented gap: the Mac orchestrator additionally blocks worklog writes under a Done task, but the Supabase-direct client does not). Keep the asymmetry.

- [ ] **Step 1: Write the failing tests**

```swift
import XCTest
@testable import WatchtowerCore

final class EditGatesTests: XCTestCase {
    func testCanEditOnlyWhenFresh() {
        XCTAssertTrue(canEdit(.fresh))
        XCTAssertFalse(canEdit(.cached))
        XCTAssertFalse(canEdit(.offline))
        XCTAssertFalse(canEdit(.loading))
    }
    func testCanEditTask() {
        XCTAssertTrue(canEditTask("in_progress"))
        XCTAssertFalse(canEditTask("done"))
    }
}
```

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Write the implementation**

```swift
public func canEdit(_ state: LoadState) -> Bool { state == .fresh }
public func canEditTask(_ status: String) -> Bool { status != "done" }
```

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add swift/WatchtowerCore/Sources/WatchtowerCore/Billing/EditGates.swift swift/WatchtowerCore/Tests/WatchtowerCoreTests/EditGatesTests.swift
git commit -m "feat(iphone-native): edit gates canEdit/canEditTask (Phase 5)"
```

---

### Task 5: Write-input value types + row builders + computeDerivedForWrite + rebill

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerCore/Billing/BillingWriteMapping.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/BillingWriteMappingTests.swift`

**Interfaces:**
- Consumes: `WorklogRow`, `TaskRow`, `ContractRow` (from `Billing/BillingModels.swift`); `ContractLite`, `computeWorklogBilling` (Task 1).
- Produces:
  - Value inputs: `struct WorklogWriteInput { var workDate: String; var minutes: Double; var reportedMinutes: Double?; var description: String? }`, `struct TaskWriteInput { var epicId: Int; var number: String?; var title: String; var status: String; var estimatedMinutes: Double?; var description: String? }`, `struct ContractWriteInput { var effectiveFrom: String; var endDate: String?; var rateType: String; var rateAmount: Double; var hoursPerDay: Double; var mdLimit: Double? }`
  - Encodable payloads: `WorklogInsertPayload`, `WorklogUpdatePayload`, `TaskInsertPayload`, `TaskUpdatePayload`, `ContractInsertPayload`, `ContractEndDatePayload`, `ContractUpdatePayload`, `DayOffUpsertPayload`, `SoftDeletePayload` — all `Encodable` with snake_case `CodingKeys` matching the Supabase columns.
  - Builder functions returning those payloads: `buildWorklogInsert`, `buildWorklogUpdate`, `buildTaskInsert`, `buildTaskUpdate`, `buildContractInsert`, `buildContractEndDate`, `buildContractUpdate`, `buildDayOffUpsert`, `softDelete(now:)`.
  - `func computeDerivedForWrite(contracts: [ContractRow], projectId: Int, minutes: Double, reportedMinutes: Double?, workDate: String) -> WorklogBilling`
  - `func rebillProjectWorklogs(_ worklogs: [WorklogRow], projectId: Int, contracts: [ContractRow]) -> [WorklogRow]`
  - `func lite(_ contracts: [ContractRow], projectId: Int) -> [ContractLite]`

Reference `billingWrites.ts` for exact column sets. Key rows: worklog insert hard-codes `source: "manual"`, `external_id: null`, `jira_uploaded: false`, `deleted_at: null`, and carries `effective_minutes`/`resolved_rate`/`earned_amount` from the passed `WorklogBilling`. Contract insert carries nullable `contract_group_id`. Day-off upsert writes `sync_id`, `date`, `kind`, `note: null`, `deleted_at: null`, `updated_at`.

- [ ] **Step 1: Write the failing tests** (assert the pure functions; payloads verified via `JSONEncoder` key/values)

```swift
import XCTest
@testable import WatchtowerCore

final class BillingWriteMappingTests: XCTestCase {
    private func enc(_ v: Encodable) -> [String: Any] {
        let d = try! JSONEncoder().encode(AnyEncodable(v))
        return (try! JSONSerialization.jsonObject(with: d)) as! [String: Any]
    }

    func testComputeDerivedForWriteFiltersByProject() {
        let contracts = [
            ContractRow(syncId: "a", projectId: 1, effectiveFrom: "2026-01-01", endDate: nil, rateType: "hourly", rateAmount: 100, hoursPerDay: 8, mdLimit: nil, contractGroupId: nil),
            ContractRow(syncId: "b", projectId: 2, effectiveFrom: "2026-01-01", endDate: nil, rateType: "hourly", rateAmount: 999, hoursPerDay: 8, mdLimit: nil, contractGroupId: nil),
        ]
        let r = computeDerivedForWrite(contracts: contracts, projectId: 1, minutes: 60, reportedMinutes: nil, workDate: "2026-03-01")
        XCTAssertEqual(r.earnedAmount, 100)
    }

    func testWorklogInsertHardcodesManualSource() {
        let billing = WorklogBilling(effectiveMinutes: 60, resolvedRate: 100, earnedAmount: 100)
        let p = buildWorklogInsert(taskId: 7, input: WorklogWriteInput(workDate: "2026-03-01", minutes: 60, reportedMinutes: nil, description: "x"),
                                   syncId: "s1", now: "2026-03-01T10:00:00Z", billing: billing)
        let j = enc(p)
        XCTAssertEqual(j["source"] as? String, "manual")
        XCTAssertTrue(j["external_id"] is NSNull)
        XCTAssertEqual(j["work_date"] as? String, "2026-03-01")
        XCTAssertEqual(j["effective_minutes"] as? Double, 60)
    }

    func testSoftDeleteStampsBothTimestamps() {
        let j = enc(softDelete(now: "2026-03-01T10:00:00Z"))
        XCTAssertEqual(j["deleted_at"] as? String, "2026-03-01T10:00:00Z")
        XCTAssertEqual(j["updated_at"] as? String, "2026-03-01T10:00:00Z")
    }

    func testRebillRecomputesOnlyTargetProject() {
        let contracts = [ContractRow(syncId: "a", projectId: 1, effectiveFrom: "2026-01-01", endDate: nil, rateType: "hourly", rateAmount: 200, hoursPerDay: 8, mdLimit: nil, contractGroupId: nil)]
        let w1 = makeWorklog(projectId: 1, minutes: 60, earned: 0)
        let w2 = makeWorklog(projectId: 2, minutes: 60, earned: 42)
        let out = rebillProjectWorklogs([w1, w2], projectId: 1, contracts: contracts)
        XCTAssertEqual(out[0].earnedAmount, 200)
        XCTAssertEqual(out[1].earnedAmount, 42) // untouched
    }
}
```

Provide test helpers `makeWorklog(projectId:minutes:earned:)` and a minimal `AnyEncodable` wrapper in the test file. (If `WorklogRow`'s initializer differs, adjust the helper to the real memberwise init from `BillingModels.swift`.)

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Write the implementation** — value types, `Encodable` payload structs with explicit snake_case `CodingKeys` and `encodeNil` for nullable columns, builders, `lite`, `computeDerivedForWrite`, `rebillProjectWorklogs`. For nullable columns that must serialize as JSON `null` (e.g. `external_id`, `note`), use `Optional` properties encoded with `encodeIfPresent` where the DB default suffices, but for columns the TS explicitly sets to `null` on insert, encode explicit null via `try container.encode(String?.none, forKey:)` inside a custom `encode(to:)`.

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add swift/WatchtowerCore/Sources/WatchtowerCore/Billing/BillingWriteMapping.swift swift/WatchtowerCore/Tests/WatchtowerCoreTests/BillingWriteMappingTests.swift
git commit -m "feat(iphone-native): write-row builders + computeDerivedForWrite + rebill (Phase 5)"
```

---

### Task 6: ProjectDetail helpers

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerCore/Billing/ProjectDetailHelpers.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/ProjectDetailHelpersTests.swift`

**Interfaces:**
- Consumes: `ContractRow`, `WorklogRow`, existing `CzFormat` helpers (`Formatting/`).
- Produces: `func assignWorklogToContract(workDate: String, contracts: [ContractRow]) -> ContractRow?`, `func activeContract(_ contracts: [ContractRow], today: String) -> ContractRow?`, `func rateLabel(_ c: ContractRow) -> String`, `struct ContractEarning: Equatable { let contract: ContractRow; let earnedCzk: Double }`, `func rollupEarningsByContract(worklogs: [WorklogRow], contracts: [ContractRow]) -> [ContractEarning]`, `func sharedMemberCount(_ contracts: [ContractRow], groupId: String) -> Int`.

Port from `packages/ui-core/src/projectDetailHelpers.ts`. `assignWorklogToContract` = same latest-effectiveFrom<=date rule as `resolveContract`. `rollupEarningsByContract` returns one entry per contract period, sorted desc by `effectiveFrom`, summing each worklog's `earnedAmount` (already client-derived) into the contract covering its `workDate`. `rateLabel`: `"<amount> Kč/h"` for hourly, `"<amount> Kč/MD"` for daily, using `CzFormat` bare-number formatting.

- [ ] **Step 1: Write failing tests** covering: active contract picks latest ≤ today; rollup groups by covering contract and sorts desc; `sharedMemberCount` counts distinct projectIds in a group; `rateLabel` for hourly + daily.
- [ ] **Step 2: Run to verify failure** — FAIL.
- [ ] **Step 3: Write implementation.**
- [ ] **Step 4: Run to verify pass** — PASS.
- [ ] **Step 5: Commit**

```bash
git add swift/WatchtowerCore/Sources/WatchtowerCore/Billing/ProjectDetailHelpers.swift swift/WatchtowerCore/Tests/WatchtowerCoreTests/ProjectDetailHelpersTests.swift
git commit -m "feat(iphone-native): port project-detail helpers (Phase 5)"
```

---

### Task 7: Board aggregation

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerCore/Billing/Board.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/BoardTests.swift`

**Interfaces:**
- Consumes: `TaskRow`, `WorklogRow`.
- Produces: `enum BoardColumn: String, CaseIterable { case todo, doing, to_accept, done }`, `let visibleBoardColumns: [BoardColumn] = [.todo, .doing, .to_accept]`, `func columnForStatus(_ jiraStatus: String?) -> BoardColumn`, `struct BoardCard: Equatable, Identifiable { let id: String /* syncId */; let taskNumber: String?; let taskTitle: String; let jiraStatus: String; let projectColor: String?; let loggedMinutes: Double; let estimateMinutes: Double? }`, `struct BoardData: Equatable { let columns: [BoardColumn: [BoardCard]]; let totalCards: Int }`, `func buildBoard(tasks: [TaskRow], worklogs: [WorklogRow], projectId: Int?) -> BoardData`.

Port `packages/shared/src/billing/board/board.ts` exactly: `STATUS_TO_COLUMN` map (`New`/`To Do`→todo; `In Progress`/`In Review`→doing; `In Test`/`To Accept`→to_accept; `Done`→done), `HIDDEN_STATUSES = {"Waiting","Done"}` (dropped as cards), unknown→doing, sum `loggedMinutes` from worklogs by `taskNumber`, natural-numeric sort by `taskNumber` within a column. Only `visibleBoardColumns` are ever rendered.

- [ ] **Step 1: Write failing tests**: status→column mapping incl. unknown→doing; hidden statuses excluded; project filter; logged-minutes sum by taskNumber; sort order.
- [ ] **Step 2: Run to verify failure** — FAIL.
- [ ] **Step 3: Write implementation.**
- [ ] **Step 4: Run to verify pass** — PASS.
- [ ] **Step 5: Commit**

```bash
git add swift/WatchtowerCore/Sources/WatchtowerCore/Billing/Board.swift swift/WatchtowerCore/Tests/WatchtowerCoreTests/BoardTests.swift
git commit -m "feat(iphone-native): port buildBoard aggregation (Phase 5)"
```

---

## Milestone 2 — Shared dataset + write client

### Task 8: Migrate `BillingFeature.dataset` to `@Shared(.inMemory)`

**Files:**
- Modify: `swift/WatchtowerCore/Sources/WatchtowerCore/Features/BillingFeature.swift`
- Modify: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/BillingFeatureTests.swift`

**Interfaces:**
- Produces: `@Shared(.inMemory("billingDataset")) var dataset: BillingDataset?` inside `BillingFeature.State`. Reads via `store.dataset` unchanged for existing views. Editor features (later tasks) declare the identical `@Shared(.inMemory("billingDataset")) var dataset` to reference the same instance.

**Details:** Replace the plain `var dataset: BillingDataset?` with the `@Shared` property. All existing mutations (`cacheLoaded`, `fetchResponse`, `refreshResponse`) now write via `$dataset.withLock { $0 = ... }`. `LoadState` and other State fields unchanged. Existing `dashboardKpis`/etc. computed vars in views still read `billing.dataset`.

- [ ] **Step 1: Update `BillingFeatureTests` first** — shared-state assertions. In a `TestStore`, `@Shared(.inMemory(...))` seeds fresh per test; assert shared mutations by mutating the same `$0.$dataset` projection in the trailing closure, e.g.:

```swift
await store.send(.onAppear)
await store.receive(\.cacheLoaded) {
    $0.$dataset.withLock { $0 = self.ds("cached") }
    $0.loadState = .cached
}
```

Add one new test `testSharedDatasetVisibleToSecondReducer` proving a second reducer constructed with `@Shared(.inMemory("billingDataset"))` sees the same value after a write (this locks the sharing contract Milestone 3 depends on).

- [ ] **Step 2: Run to verify failure** — `swift test --filter BillingFeatureTests` → FAIL (compile: `$dataset` on a non-Shared property).
- [ ] **Step 3: Apply the `@Shared` migration in `BillingFeature.swift`.**
- [ ] **Step 4: Run to verify pass** — `swift test --filter BillingFeatureTests` → PASS. Then run the FULL package suite `swift test` and confirm the pre-existing tests still pass (no regression from the ownership change).
- [ ] **Step 5: Commit**

```bash
git add swift/WatchtowerCore/Sources/WatchtowerCore/Features/BillingFeature.swift swift/WatchtowerCore/Tests/WatchtowerCoreTests/BillingFeatureTests.swift
git commit -m "refactor(iphone-native): billing dataset -> @Shared(.inMemory) (Phase 5)"
```

---

### Task 9: `BillingWriteClient` dependency

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerCore/Dependencies/BillingWriteClient.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/BillingWriteClientTests.swift`

**Interfaces:**
- Produces a `@DependencyClient struct BillingWriteClient` with async throws closures (each performs one Supabase write against the shared write client instance; all take already-built payloads/ids so the reducers stay pure and testable):
  - `insertWorklog: @Sendable (_ payload: WorklogInsertPayload) async throws -> Void`
  - `updateWorklog: @Sendable (_ syncId: String, _ payload: WorklogUpdatePayload) async throws -> Void`
  - `updateWorklogRaw: @Sendable (_ syncId: String, _ payload: SoftDeletePayload) async throws -> Void` (soft delete)
  - `insertTask: @Sendable (_ payload: TaskInsertPayload) async throws -> Int` (returns new DB id via `.select("id").single()`)
  - `updateTask: @Sendable (_ syncId: String, _ payload: TaskUpdatePayload) async throws -> Void`
  - `deleteTask: @Sendable (_ syncId: String, _ payload: SoftDeletePayload) async throws -> Void`
  - `insertContracts: @Sendable (_ payloads: [ContractInsertPayload]) async throws -> Void` (batch; single-element for solo)
  - `updateContractEndDate: @Sendable (_ syncId: String, _ payload: ContractEndDatePayload) async throws -> Void`
  - `updateContract: @Sendable (_ syncId: String, _ payload: ContractUpdatePayload) async throws -> Void`
  - `deleteContract: @Sendable (_ syncId: String, _ payload: SoftDeletePayload) async throws -> Void`
  - `deleteContractGroup: @Sendable (_ groupId: String, _ payload: SoftDeletePayload) async throws -> Void` (`.eq("contract_group_id", groupId)`)
  - `upsertDayOff: @Sendable (_ payload: DayOffUpsertPayload) async throws -> Void` (`onConflict: "date"`)
  - `deleteDayOff: @Sendable (_ date: String, _ payload: SoftDeletePayload) async throws -> Void`
  - `findDayOffSyncId: @Sendable (_ date: String) async throws -> String?` (query INCLUDING soft-deleted rows: `.select("sync_id").eq("date", date).limit(1)`, no `deleted_at` filter)
- `liveValue`: reuse the same lazy `Supabase.SupabaseClient` construction pattern as `BillingClient` (extract a shared `SupabaseClientFactory` helper if convenient, else duplicate the lazy `LockIsolated` builder — match existing style). `testValue = BillingWriteClient()` (unimplemented closures).

- [ ] **Step 1: Write a smoke test** — `testValue` exists and closures are overridable; verify `findDayOffSyncId` can be stubbed to return a value. (Live Supabase calls are not host-testable; the reducer tests in Milestone 3 exercise the write flow with a stubbed client.)
- [ ] **Step 2: Run to verify failure** — FAIL.
- [ ] **Step 3: Write the implementation.** Build the `struct` + `DependencyKey`/`liveValue`/`testValue` + `DependencyValues` accessor (`\.billingWriteClient`), mirroring `Dependencies/BillingClient.swift`.
- [ ] **Step 4: Run to verify pass** — PASS.
- [ ] **Step 5: Commit**

```bash
git add swift/WatchtowerCore/Sources/WatchtowerCore/Dependencies/BillingWriteClient.swift swift/WatchtowerCore/Tests/WatchtowerCoreTests/BillingWriteClientTests.swift
git commit -m "feat(iphone-native): BillingWriteClient dependency (Phase 5)"
```

---

## Milestone 3 — Worklog & Task mutations + Records editing UI

### Task 10: `WorklogFormFeature`

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerCore/Features/WorklogFormFeature.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/WorklogFormFeatureTests.swift`

**Interfaces:**
- Consumes: `@Shared(.inMemory("billingDataset")) var dataset`, `parseMinutes`, `computeDerivedForWrite`, `buildWorklogInsert/Update/softDelete`, `BillingWriteClient`, `WorklogRow`, `TaskRow`.
- Produces `WorklogFormFeature` with:
  - `State`: `mode: Mode` (`.create(task: TaskRow, date: String)` | `.edit(WorklogRow)`), `hoursText: String`, `descriptionText: String`, `isSaving: Bool`, `errorMessage: String?`, `@Shared(.inMemory("billingDataset")) var dataset`. `@Presents`-friendly (`Equatable`, `Identifiable` by a stable id).
  - `Action`: `binding`, `saveTapped`, `deleteTapped`, `writeFinished(Result<Void, BillingWriteError>)`, `delegate(Delegate)` where `enum Delegate { case dismissed }`.
  - Save flow: parse `hoursText` via `parseMinutes` → if nil, set `errorMessage = "Enter a valid duration"` and return. Guard `canEdit(loadState)`? loadState isn't in shared dataset — pass editability in via `Mode`/init or read a `@Shared` loadState. **Decision:** add `@Shared(.inMemory("billingLoadState")) var loadState: LoadState` written by `BillingFeature` alongside dataset in Task 8 (add that shared write in Task 8). Guard `canEdit(loadState)` → else `errorMessage = "Not editable while offline"`.
  - On valid save: snapshot `dataset`; compute billing via `computeDerivedForWrite`; build optimistic `WorklogRow` (create → mint `syncId = uuid`, projectId/name from the task; edit → keep syncId, recompute against existing.projectId); `$dataset.withLock { patch worklogs array }`; effect `await BillingWriteClient.insert/update`; `writeFinished`: on success `.send(.delegate(.dismissed))`; on failure restore snapshot via `$dataset.withLock` + set `errorMessage`.
  - Delete (edit mode only): optimistic remove + soft-delete write, same rollback.

- [ ] **Step 1: Write failing `TestStore` tests**:
  - `testCreateOptimisticallyInsertsThenConfirms` — seed shared dataset with a task + contract; `.send(.binding(hoursText="1:30"))`, `.send(.saveTapped)` asserts optimistic worklog appears (derived earnedAmount correct), `.receive(\.writeFinished.success)` → `.receive(\.delegate.dismissed)`.
  - `testCreateRollbackOnWriteError` — stub `insertWorklog` to throw; assert the optimistic row is removed again and `errorMessage` set.
  - `testInvalidDurationShowsError` — `hoursText="abc"`, `saveTapped` → errorMessage set, no write effect.
  - `testDeleteSoftRemoves`.
  Use `store.exhaustivity = .off(showSkippedAssertions: false)` if merged effects fire.
- [ ] **Step 2: Run to verify failure** — FAIL.
- [ ] **Step 3: Write the reducer.**
- [ ] **Step 4: Run to verify pass** — PASS.
- [ ] **Step 5: Commit**

```bash
git add swift/WatchtowerCore/Sources/WatchtowerCore/Features/WorklogFormFeature.swift swift/WatchtowerCore/Tests/WatchtowerCoreTests/WorklogFormFeatureTests.swift
git commit -m "feat(iphone-native): WorklogFormFeature optimistic write+rollback (Phase 5)"
```

> Task 8 addendum required by this task: also add `@Shared(.inMemory("billingLoadState")) var loadState` written by `BillingFeature`. Fold this into Task 8's edits and tests (assert loadState shared write) if not already done.

---

### Task 11: `TaskFormFeature`

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerCore/Features/TaskFormFeature.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/TaskFormFeatureTests.swift`

**Interfaces:**
- Consumes: shared dataset + loadState, `canEditTask`, `parseMinutes` (for estimate), `buildTaskInsert/Update/softDelete`, `BillingWriteClient` (`insertTask` returns id), `TaskRow`, `EpicRow`, `ProjectRow`.
- Produces `TaskFormFeature`:
  - `State`: `mode` (`.create(epicId: Int)` | `.edit(TaskRow)`), fields (`numberText`, `titleText`, `status`, `estimateText`, `descriptionText`), `isSaving`, `errorMessage?`, shared dataset/loadState.
  - Save: guard `canEdit(loadState)`; in edit mode guard `canEditTask(existing.status)` → else `errorMessage = "Task is closed (Done)"` and no write. Create: resolve project via epic→project chain in the shared dataset (error `"Project not found"` if missing); optimistic insert with placeholder `taskId: 0`; `await insertTask` returns real id; second `$dataset.withLock` swaps placeholder→real id. Update/delete: optimistic + write + rollback.
- Tests: create two-phase id swap; `canEditTask` blocks edit/delete of a Done task with no write; rollback on error; project-not-found path.

- [ ] Steps 1–5 as per the TDD pattern above.

```bash
git commit -m "feat(iphone-native): TaskFormFeature (two-phase id, canEditTask gate) (Phase 5)"
```

---

### Task 12: `RecordsFeature` — presentation state + row/affordance actions

**Files:**
- Modify: `swift/WatchtowerCore/Sources/WatchtowerCore/Features/RecordsFeature.swift`
- Modify: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/RecordsFeatureTests.swift`

**Interfaces:**
- Adds to `RecordsFeature.State`: `@Presents var worklogForm: WorklogFormFeature.State?`, `@Presents var taskForm: TaskFormFeature.State?`. Adds `.board` to `Section`.
- Adds to `Action`: `addWorklogTapped(date: String, task: TaskRow?)`, `worklogRowTapped(WorklogRow)`, `gridCellTapped(taskId: Int, date: String, existing: WorklogRow?)`, `addTaskTapped(epicId: Int)`, `taskRowTapped(TaskRow)`, `setDayOff(date: String, kind: String)`, `clearDayOff(date: String)`, `worklogForm(PresentationAction<WorklogFormFeature.Action>)`, `taskForm(PresentationAction<TaskFormFeature.Action>)`.
- Composition: `.ifLet(\.$worklogForm, action: \.worklogForm) { WorklogFormFeature() }` and same for `taskForm`. On `.worklogForm(.presented(.delegate(.dismissed)))` and `.taskForm(...)` → set the `@Presents` state to nil (dismiss).
- Day-off: `setDayOff`/`clearDayOff` here own the tombstone-aware `sync_id` resolution (it needs `BillingWriteClient.findDayOffSyncId` + shared dataset), so this reducer gets `@Shared` dataset/loadState + `@Dependency(\.billingWriteClient)`. Implement the 3-tier rule: (1) reuse a visible cached row's syncId; (2) else `await findDayOffSyncId(date)`; (3) else mint uuid. Optimistic patch + upsert/soft-delete + rollback.

- [ ] **Step 1: Write failing tests**: `addWorklogTapped` populates `worklogForm` state; `worklogForm` dismissed delegate clears it; `setDayOff` reuses a tombstoned syncId (stub `findDayOffSyncId` → "old"), optimistic patch adds the day-off with that syncId; `clearDayOff` soft-removes.
- [ ] **Step 2: Run to verify failure** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify pass** — PASS (+ full `swift test`).
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(iphone-native): RecordsFeature presentation + day-off tombstone rule (Phase 5)"
```

---

### Task 13: Editing views — WorklogFormView, TaskFormView + Records wiring

**Files:**
- Create: `apps/iphone-native/Watchtower/Views/WorklogFormView.swift`
- Create: `apps/iphone-native/Watchtower/Views/TaskFormView.swift`
- Modify: `apps/iphone-native/Watchtower/Views/RecordsView.swift` (+ its subviews for list/grid/tasks/time-off — make rows tappable, add `+` buttons)
- Modify: `apps/iphone-native/Watchtower/Views/AppShellView.swift` (only if the `.board` section needs a tab-content branch — see Task 17)

**Details:**
- `WorklogFormView(store: StoreOf<WorklogFormFeature>)` — `@Bindable var store` (copy the `AuthView` binding pattern). A `Form`/`GlassCard` with: a duration `TextField` bound to `$store.hoursText` (keyboard `.numbersAndPunctuation`), a description `TextField`, an inline error `Text` when `store.errorMessage != nil`, a Save button (disabled while `store.isSaving`) sending `.saveTapped`, and (edit mode) a Delete button sending `.deleteTapped`. Close button sends `.delegate(.dismissed)`. Add `.accessibilityLabel` to the close/save glyph buttons.
- `TaskFormView` — analogous, with a status picker + estimate field.
- `RecordsView` subviews: wrap `WorklogRowView`/`TaskRowView` in `Button`/`.contentShape(Rectangle()).onTapGesture` sending `worklogRowTapped`/`taskRowTapped`. Add a `+` toolbar/section button per section sending `addWorklogTapped`/`addTaskTapped`. Grid cells (`TaskGridView`) become tappable → `gridCellTapped` (presents `WorklogFormFeature` seeded `.create(task:date:)` or `.edit`). Time-off day cells → `setDayOff`/`clearDayOff`.
- Present the forms as sheets: `.sheet(item: $store.scope(state: \.worklogForm, action: \.worklogForm)) { WorklogFormView(store: $0) }` and same for `taskForm`, attached in `RecordsView`.
- Run `cd apps/iphone-native && xcodegen generate` after adding the two new view files.

- [ ] **Step 1: Write the views + wiring** (no unit test — SwiftUI views; correctness verified by the build + sim smoke in Task 18).
- [ ] **Step 2: Build**

```bash
cd apps/iphone-native && xcodegen generate
xcodebuild -project Watchtower.xcodeproj -scheme Watchtower \
  -destination 'platform=iOS Simulator,name=iPhone 16e' \
  -skipMacroValidation -skipPackagePluginValidation build 2>&1 | tail -20
```
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 3: Commit**

```bash
git add apps/iphone-native/Watchtower/Views/WorklogFormView.swift apps/iphone-native/Watchtower/Views/TaskFormView.swift apps/iphone-native/Watchtower/Views/RecordsView.swift apps/iphone-native/project.yml
git commit -m "feat(iphone-native): worklog/task editing sheets + tappable Records rows (Phase 5)"
```

---

## Milestone 4 — ProjectDetail + contracts

### Task 14: `ContractDrawerFeature`

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerCore/Features/ContractDrawerFeature.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/ContractDrawerFeatureTests.swift`

**Interfaces:**
- Consumes: shared dataset/loadState, `contractsOverlap`, `previousDay`, `openEndedSentinel`, `buildContractInsert/EndDate/Update/softDelete`, `rebillProjectWorklogs`, `computeDerivedForWrite`, `BillingWriteClient`, `ContractRow`.
- Produces `ContractDrawerFeature`:
  - `State`: `mode` (`.create(projectId: Int)` | `.edit(ContractRow)`), fields (`effectiveFromText`, `endDateText`, `rateType`, `rateAmountText`, `hoursPerDayText`, `mdLimitText`, `sharedProjectIds: Set<Int>`), `isSaving`, `errorMessage?`, shared dataset/loadState.
  - Save logic ports `create/update/deleteContractCore`:
    - **Solo** (≤1 target): `precheckCreate` — auto-close a prior open-ended contract on the project (`buildContractEndDate(previousDay(newFrom))`), overlap-check the projected state (excluding the just-closed prior), abort with `errorMessage` on conflict (NO write). Else optimistic-patch contracts (incl. closing prior) + `rebillProjectWorklogs` for that project, then write `[end-date update of prior] → [insert]` sequentially; rollback both contracts & worklogs on error.
    - **Group** (>1 target, `contractGroupId = uuid`): precheck EVERY member against the pristine cache first — any single conflict aborts the whole group, no partial write. Then optimistic-patch + rebill across all targets, then batch-insert all group rows.
    - **Update**: solo path like create-solo (overlap excludes self by syncId); group path reconciles membership (dropped→soft-delete, retained→update, added→create-precheck), checks all before any write, rebills the union of old+new member projects.
    - **Delete**: solo→soft-delete + rebill; group→`deleteContractGroup` + rebill all former members.
  - `delegate(.dismissed)` on success.
- Tests (TestStore): solo create closes prior + rebills; overlap conflict aborts with error and no write; group create all-or-nothing (one conflict → nothing written); delete solo soft-removes + rebills; rollback on write error.

- [ ] Steps 1–5 per TDD. This is the highest-risk reducer — write thorough tests first.

```bash
git commit -m "feat(iphone-native): ContractDrawerFeature (solo+group, overlap, rebill) (Phase 5)"
```

---

### Task 15: `ProjectDetailFeature`

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerCore/Features/ProjectDetailFeature.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/ProjectDetailFeatureTests.swift`

**Interfaces:**
- Produces `ProjectDetailFeature`:
  - `State: Equatable, Identifiable`: `id = projectId`, `projectId: Int`, `month: String` (seeded from `initialMonth`), `@Presents var contractDrawer: ContractDrawerFeature.State?`, shared dataset/loadState (for reads).
  - `Action`: `monthStepped(Int)`, `addContractTapped`, `contractRowTapped(ContractRow)`, `contractDrawer(PresentationAction<ContractDrawerFeature.Action>)`.
  - `monthStepped` uses the existing UTC `addMonths` helper (grep `Workdays`/`Earnings` for it). `addContractTapped` → present `contractDrawer` `.create(projectId:)` only if `canEdit(loadState)`. `contractRowTapped` → present `.edit`. On `contractDrawer(.presented(.delegate(.dismissed)))` → nil it out.
- Tests: month stepping; add/edit presents drawer only when editable; drawer dismissal clears state.

- [ ] Steps 1–5.

```bash
git commit -m "feat(iphone-native): ProjectDetailFeature (month cursor + contract drawer) (Phase 5)"
```

---

### Task 16: `ProjectDetailView` + `ContractDrawerView`

**Files:**
- Create: `apps/iphone-native/Watchtower/Views/ProjectDetailView.swift`
- Create: `apps/iphone-native/Watchtower/Views/ContractDrawerView.swift`

**Details:**
- `ProjectDetailView(store: StoreOf<ProjectDetailFeature>, billing: StoreOf<BillingFeature>)` renders the 4 sections from the React reference: back/title bar, header card (project name + month stepper + hours stat + optional active-rate stat via `activeContract`), rate-history list (`rollupEarningsByContract`, group badge via `sharedMemberCount`, empty state, inline `errorMessage`, "＋ Add rate" gated on `canEdit`, rows tappable when editable), and the monthly worklog ledger (sorted desc, total footer). Present `ContractDrawerView` via `.sheet(item: $store.scope(state: \.contractDrawer, action: \.contractDrawer))`.
- `ContractDrawerView(store:)` — `@Bindable`, fields per `ContractWriteInput` + a shared-projects checklist (list `dataset.projects` where `kind == "work"` and `id != projectId`), Save/Delete/Close. Add a11y labels to glyph buttons.
- `cd apps/iphone-native && xcodegen generate`.

- [ ] **Step 1: Write the views.**
- [ ] **Step 2: Build** (same xcodebuild command) → `** BUILD SUCCEEDED **`.
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(iphone-native): ProjectDetailView + ContractDrawerView (Phase 5)"
```

---

### Task 17: Wire ProjectDetail navigation from Earnings & Reports

**Files:**
- Modify: `swift/WatchtowerCore/Sources/WatchtowerCore/Features/EarningsFeature.swift`
- Modify: `swift/WatchtowerCore/Sources/WatchtowerCore/Features/ReportsFeature.swift`
- Modify: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/EarningsFeatureTests.swift`, `ReportsFeatureTests.swift`
- Modify: `apps/iphone-native/Watchtower/Views/EarningsView.swift`, `ReportsView.swift`, `AppShellView.swift`

**Details:**
- Add `@Presents var projectDetail: ProjectDetailFeature.State?` to both `EarningsFeature.State` and `ReportsFeature.State`. Compose `.ifLet(\.$projectDetail, action: \.projectDetail) { ProjectDetailFeature() }`.
- `EarningsFeature.openProjectTapped(projectId)` (currently a no-op TODO) → set `projectDetail = ProjectDetailFeature.State(projectId: projectId, month: state.selectedMonth)`.
- `ReportsFeature`: replace the no-op — make `openProjectTapped(projectId)` set `projectDetail` seeded with the current report range's month (use `range`'s start month or `today`'s month; pick the reference month the React `onOpenProject` passes — the currently viewed month). **Drop the unwired `onOpenProject` closure param** on `ReportsView`; route taps through `reports.send(.openProjectTapped(id))` for consistency with Earnings. Update `AppShellView.tabContent(.reports)` to remove the `onOpenProject: { _ in }` closure.
- Views: wrap the Earnings and Reports tab bodies in `NavigationStack` and add `.navigationDestination(item: $store.scope(state: \.projectDetail, action: \.projectDetail)) { ProjectDetailView(store: $0, billing: billing) }`. This is the app's first `NavigationStack` — keep it per-tab (no global path).

- [ ] **Step 1: Update feature tests** — `openProjectTapped` populates `projectDetail` in both; dismissal clears it.
- [ ] **Step 2: Run to verify failure** — FAIL.
- [ ] **Step 3: Implement reducers + views.** `xcodegen generate`.
- [ ] **Step 4: Run to verify pass** — `swift test` full suite PASS; then build → `** BUILD SUCCEEDED **`.
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(iphone-native): wire ProjectDetail push from Earnings & Reports (Phase 5)"
```

---

## Milestone 5 — Board (read-only)

### Task 18: Board section + `BoardView`

**Files:**
- Modify: `swift/WatchtowerCore/Sources/WatchtowerCore/Features/RecordsFeature.swift` (add `.board` to `Section` — done in Task 12; here add board filter state `boardProjectId: Int?` + `boardProjectChanged` action)
- Modify: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/RecordsFeatureTests.swift`
- Create: `apps/iphone-native/Watchtower/Views/BoardView.swift`
- Modify: `apps/iphone-native/Watchtower/Views/RecordsView.swift` (render `BoardView` when `section == .board`; add `.board` to the section switcher/segmented control)

**Details:**
- `BoardView(records: StoreOf<RecordsFeature>, billing: StoreOf<BillingFeature>)` — a horizontally scrolling row of the 3 `visibleBoardColumns`, each a titled column with a count badge and a vertical list of `BoardCard` tiles (project-color dot, `taskNumber` mono, 2-line title, raw `jiraStatus`, `"<logged> h"` or `"<logged> / <estimate> h"`). A project filter picker bound to `boardProjectChanged`. Empty state "No tasks from the Jira board." **Read-only — no drag, no card actions** (iPhone has no Mac bridge; the sync/upload actions are iPad-only and out of scope).
- Data via `buildBoard(tasks:worklogs:projectId:)` (Task 7).

- [ ] **Step 1: Test** the new `boardProjectChanged` reducer action (filter state). BoardView itself is verified by build + sim.
- [ ] **Step 2: Run to verify failure** — FAIL. **Step 3: Implement.** `xcodegen generate`.
- [ ] **Step 4:** full `swift test` PASS; build → `** BUILD SUCCEEDED **`.
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(iphone-native): read-only Board (Kanban) section + view (Phase 5)"
```

---

## Milestone 6 — Integration verification

### Task 19: Full build, simulator smoke, final review prep

**Files:** none (verification only).

- [ ] **Step 1: Full package test suite**

```bash
cd swift/WatchtowerCore && swift test 2>&1 | tail -15
```
Expected: all tests pass (89 prior + all Phase 5 additions). Record the new total.

- [ ] **Step 2: Clean build + install + launch on the simulator**

```bash
cd apps/iphone-native && xcodegen generate
DEST='platform=iOS Simulator,name=iPhone 16e'
xcodebuild -project Watchtower.xcodeproj -scheme Watchtower -destination "$DEST" \
  -skipMacroValidation -skipPackagePluginValidation build 2>&1 | tail -8
xcrun simctl boot "iPhone 16e" 2>/dev/null; open -a Simulator
APP="$(xcodebuild -project Watchtower.xcodeproj -scheme Watchtower -showBuildSettings -destination "$DEST" | awk '/ CODESIGNING_FOLDER_PATH/{ $1=""; print substr($0,2) }')"
xcrun simctl install booted "$APP"
xcrun simctl launch booted cz.greencode.watchtower.ios
```

- [ ] **Step 3: Manual smoke** (Supabase session persists per prior phases; default dashboard tab renders). Since automated taps are unavailable in this environment (per [[iphone-ondevice-verification]]), screenshot the dashboard to confirm the app still launches and the signed-in shell renders after the write-layer changes. Note in the ledger that interactive write flows (open a form, save, see optimistic update) could not be tap-automated and rely on the reducer TestStore coverage as the correctness surface.

- [ ] **Step 4:** No commit (verification only). Proceed to the whole-branch review.

---

## Self-Review (author checklist — completed)

**Spec coverage:** worklog CRUD (T5/T10/T13) ✓; task CRUD incl. canEditTask + two-phase id (T4/T11/T13) ✓; contract CRUD incl. group/overlap/rebill (T3/T5/T14/T16) ✓; time-off set/clear incl. tombstone sync_id rule (T12) ✓; client-derived billing (T1/T5) ✓; parseMinutes (T2) ✓; canEdit/canEditTask gates (T4) ✓; optimistic patch + rollback (T8 shared dataset + T10/T11/T12/T14) ✓; ProjectDetail view + contracts (T6/T15/T16/T17) ✓; Board read-only (T7/T18) ✓; DATE-shift guard (T3 previousDay + opaque-string constraint) ✓; error surfacing (per-feature `errorMessage`) ✓; offline-write behavior (canEdit gate, online-direct) ✓.

**Deferred Phase-7 items:** explicitly carried as out-of-scope in Global Constraints; the only in-path exception (a11y labels on NEW glyph controls) is called out in T13/T16/T18.

**Type consistency:** `@Shared(.inMemory("billingDataset"))` / `("billingLoadState")` keys are identical across BillingFeature and every editor feature. `WorklogWriteInput`/`TaskWriteInput`/`ContractWriteInput`, the `*Payload` structs, and the `BillingWriteClient` closure signatures are defined once (T5/T9) and referenced unchanged thereafter. `delegate(.dismissed)` is the uniform dismissal contract for all presented editor features.

**Known documented gap (not a bug to fix here):** `canEditTask` gates task update/delete only, not worklog writes — faithful to the TS source; the Supabase-direct path has no server-side Done-task guard. Flagged in T4.
