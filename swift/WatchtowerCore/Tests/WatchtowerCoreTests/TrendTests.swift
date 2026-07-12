import XCTest
@testable import WatchtowerCore

final class TrendTests: XCTestCase {
    private func wl(_ d: String, _ pid: Int, _ eff: Double, _ earned: Double?) -> WorklogRow {
        WorklogRow(syncId: "\(d)-\(pid)", workDate: d, minutes: eff, reportedMinutes: nil, effectiveMinutes: eff,
            earnedAmount: earned, description: nil, projectId: pid, projectName: "P", projectColor: nil,
            projectKind: "work", isBillable: true, taskNumber: nil, taskTitle: nil, source: nil)
    }
    func testTrendSeriesMonthly() {
        let rows = [wl("2026-05-10",1,60,1000), wl("2026-06-01",1,30,500), wl("2026-06-02",1,30,nil), wl("2026-07-01",2,60,900)]
        let t = trendSeries(rows, from: "2026-05-01", to: "2026-06-30", granularity: .month, projectId: nil)
        XCTAssertEqual(t.map(\.bucket), ["2026-05","2026-06"])
        XCTAssertEqual(t.first(where:{$0.bucket=="2026-06"})?.minutes, 60)
        XCTAssertEqual(t.first(where:{$0.bucket=="2026-06"})?.earnedCzk, 500) // one row nil-earned
    }
    func testTrendSeriesProjectFilter() {
        let rows = [wl("2026-06-01",1,60,100), wl("2026-06-01",2,90,200)]
        let t = trendSeries(rows, from: "2026-06-01", to: "2026-06-30", granularity: .month, projectId: 2)
        XCTAssertEqual(t.map(\.minutes), [90])
    }
    func testRateMarkersDropFirstAndFilter() {
        func c(_ ef: String) -> ContractRow { ContractRow(syncId: ef, projectId: 1, effectiveFrom: ef, endDate: nil,
            rateType: "hourly", rateAmount: 1000, hoursPerDay: 8, mdLimit: nil, contractGroupId: nil) }
        let contracts = [c("2026-01-01"), c("2026-03-01"), c("2026-08-01")]
        let m = rateChangeMarkers(contracts, from: "2026-01-01", to: "2026-06-30", projectId: 1)
        XCTAssertEqual(m.map(\.effectiveFrom), ["2026-03-01"]) // first dropped, 08-01 out of range
        XCTAssertTrue(rateChangeMarkers(contracts, from: "2026-01-01", to: "2026-06-30", projectId: nil).isEmpty)
    }
}
