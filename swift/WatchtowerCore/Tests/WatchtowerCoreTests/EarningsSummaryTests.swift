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
