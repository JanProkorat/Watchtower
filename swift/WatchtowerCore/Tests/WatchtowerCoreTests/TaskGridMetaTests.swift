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
