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
