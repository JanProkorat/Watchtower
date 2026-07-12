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
        let e = expectedEarnings(month: "2026-01", worklogs: w, contracts: [c], daysOff: [], projectIds: [])
        let workdays = workdayDates("2026-01-01", "2026-01-31", [])
        XCTAssertEqual(e.capacityMinutes, workdays.count * 8 * 60)
        XCTAssertEqual(e.expectedCzk, Double(workdays.count) * 5000, accuracy: 0.5) // one billable project, daily rate
    }

    func testExpectedEarningsProjectFilter() {
        let workdays = workdayDates("2026-01-01", "2026-01-31", [])
        let c1 = ContractRow(syncId: "c1", projectId: 1, effectiveFrom: "2026-01-01", endDate: nil,
            rateType: "daily", rateAmount: 5000, hoursPerDay: 8, mdLimit: nil, contractGroupId: nil)
        let c2 = ContractRow(syncId: "c2", projectId: 2, effectiveFrom: "2026-01-01", endDate: nil,
            rateType: "daily", rateAmount: 3000, hoursPerDay: 8, mdLimit: nil, contractGroupId: nil)
        func wl(_ id: String, _ pid: Int, _ date: String) -> WorklogRow {
            WorklogRow(syncId: id, workDate: date, minutes: 60, reportedMinutes: nil, effectiveMinutes: 60,
                earnedAmount: nil, description: nil, projectId: pid, projectName: "P\(pid)", projectColor: nil,
                projectKind: "work", isBillable: true, taskNumber: nil, taskTitle: nil, source: nil)
        }
        let w = [wl("w1", 1, "2026-01-05"), wl("w2", 2, "2026-01-06")]
        // projectIds: [1] scopes to project 1 only → 5000/day.
        let e = expectedEarnings(month: "2026-01", worklogs: w, contracts: [c1, c2], daysOff: [], projectIds: [1])
        XCTAssertEqual(e.expectedCzk, Double(workdays.count) * 5000, accuracy: 0.5)
    }

    func testExpectedEarningsAllHistory() {
        // A project whose only billable worklog is in a DIFFERENT month than `month`
        // STILL counts (all-history behavior, matches .tsx / desktop grid).
        let workdays = workdayDates("2026-01-01", "2026-01-31", [])
        let c = ContractRow(syncId: "c", projectId: 1, effectiveFrom: "2025-01-01", endDate: nil,
            rateType: "daily", rateAmount: 5000, hoursPerDay: 8, mdLimit: nil, contractGroupId: nil)
        let w = [WorklogRow(syncId: "w", workDate: "2025-11-10", minutes: 60, reportedMinutes: nil, effectiveMinutes: 60,
            earnedAmount: nil, description: nil, projectId: 1, projectName: "P", projectColor: nil,
            projectKind: "work", isBillable: true, taskNumber: nil, taskTitle: nil, source: nil)]
        let e = expectedEarnings(month: "2026-01", worklogs: w, contracts: [c], daysOff: [], projectIds: [])
        XCTAssertGreaterThan(e.expectedCzk, 0)
        XCTAssertEqual(e.expectedCzk, Double(workdays.count) * 5000, accuracy: 0.5)
    }
}
