import XCTest
@testable import WatchtowerCore

final class ContractBurnTests: XCTestCase {
    func testSoloHourlyBurnWithLimit() {
        let c = ContractRow(syncId: "c1", projectId: 1, effectiveFrom: "2026-01-01", endDate: "2026-01-31",
            rateType: "hourly", rateAmount: 1000, hoursPerDay: 8, mdLimit: 20, contractGroupId: nil)
        func wl(_ d: String, _ eff: Double) -> WorklogRow {
            WorklogRow(syncId: d, workDate: d, minutes: eff, reportedMinutes: nil, effectiveMinutes: eff,
                earnedAmount: nil, description: nil, projectId: 1, projectName: "P", projectColor: "#111111",
                projectKind: "work", isBillable: true, taskNumber: nil, taskTitle: nil, source: nil)
        }
        // 2 workdays * 8h = 16h = 960 min logged → 960/60/8 = 2.00 MD used.
        let rows = [wl("2026-01-05", 480), wl("2026-01-06", 480)]
        let projects = [ProjectRow(id: 1, name: "P", color: "#111111", kind: "work", isBillable: true)]
        let burns = contractBurn([c], rows, [], projects, today: "2026-01-15")
        XCTAssertEqual(burns.count, 1)
        let b = burns[0]
        XCTAssertEqual(b.mdsUsed, 2.0, accuracy: 0.0001)
        XCTAssertEqual(b.mdsRemaining ?? .nan, 18.0, accuracy: 0.0001)
        XCTAssertEqual(b.totalWorkdays, 21) // Jan 2026 workdays excl New Year holiday + weekends
        XCTAssertNotNil(b.projectedMds)
        XCTAssertEqual(b.endDate, "2026-01-31")
    }
    func testInactiveContractExcluded() {
        let c = ContractRow(syncId: "c1", projectId: 1, effectiveFrom: "2026-02-01", endDate: nil,
            rateType: "hourly", rateAmount: 1000, hoursPerDay: 8, mdLimit: nil, contractGroupId: nil)
        XCTAssertTrue(contractBurn([c], [], [], [], today: "2026-01-15").isEmpty)
    }
}
