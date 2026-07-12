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
