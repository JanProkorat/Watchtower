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
