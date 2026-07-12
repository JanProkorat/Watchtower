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
