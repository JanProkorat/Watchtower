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
