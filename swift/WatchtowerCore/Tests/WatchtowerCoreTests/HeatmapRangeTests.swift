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
