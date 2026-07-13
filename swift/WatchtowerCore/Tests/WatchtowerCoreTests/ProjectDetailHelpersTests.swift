import XCTest
@testable import WatchtowerCore

final class ProjectDetailHelpersTests: XCTestCase {
    private func contract(
        syncId: String, projectId: Int = 1, effectiveFrom: String, endDate: String? = nil,
        rateType: String = "hourly", rateAmount: Double = 100, hoursPerDay: Double = 8,
        mdLimit: Double? = nil, contractGroupId: String? = nil
    ) -> ContractRow {
        ContractRow(
            syncId: syncId, projectId: projectId, effectiveFrom: effectiveFrom, endDate: endDate,
            rateType: rateType, rateAmount: rateAmount, hoursPerDay: hoursPerDay,
            mdLimit: mdLimit, contractGroupId: contractGroupId
        )
    }

    private func worklog(
        syncId: String, workDate: String, earnedAmount: Double?, projectId: Int = 1
    ) -> WorklogRow {
        WorklogRow(
            syncId: syncId, workDate: workDate, minutes: 60, reportedMinutes: nil,
            effectiveMinutes: 60, earnedAmount: earnedAmount, description: nil,
            projectId: projectId, projectName: "Acme", projectColor: nil,
            projectKind: "work", isBillable: true, taskNumber: nil, taskTitle: nil, source: nil
        )
    }

    // MARK: - activeContract / assignWorklogToContract

    func testActiveContractPicksLatestEffectiveFromLessOrEqualToday() {
        let old = contract(syncId: "c1", effectiveFrom: "2026-01-01", rateAmount: 100)
        let mid = contract(syncId: "c2", effectiveFrom: "2026-04-01", rateAmount: 150)
        let future = contract(syncId: "c3", effectiveFrom: "2026-12-01", rateAmount: 200)

        let active = activeContract([old, mid, future], today: "2026-07-12")
        XCTAssertEqual(active?.syncId, "c2")
    }

    func testActiveContractReturnsNilWhenNoContractQualifies() {
        let future = contract(syncId: "c1", effectiveFrom: "2027-01-01")
        XCTAssertNil(activeContract([future], today: "2026-07-12"))
    }

    func testAssignWorklogToContractInclusiveLowerBoundary() {
        let c100 = contract(syncId: "c1", effectiveFrom: "2026-01-01", rateAmount: 100)
        let c200 = contract(syncId: "c2", effectiveFrom: "2026-06-01", rateAmount: 200)
        XCTAssertEqual(assignWorklogToContract(workDate: "2026-05-31", contracts: [c100, c200])?.rateAmount, 100)
        XCTAssertEqual(assignWorklogToContract(workDate: "2026-06-01", contracts: [c100, c200])?.rateAmount, 200)
    }

    // MARK: - rollupEarningsByContract

    func testRollupGroupsByCoveringContractAndSumsEarnings() {
        let c1 = contract(syncId: "c1", effectiveFrom: "2026-01-01", rateAmount: 100)
        let c2 = contract(syncId: "c2", effectiveFrom: "2026-04-01", rateAmount: 200)

        let worklogs = [
            worklog(syncId: "w1", workDate: "2026-02-01", earnedAmount: 500),
            worklog(syncId: "w2", workDate: "2026-03-01", earnedAmount: 250),
            worklog(syncId: "w3", workDate: "2026-05-01", earnedAmount: 1000),
            worklog(syncId: "w4", workDate: "2026-01-05", earnedAmount: nil), // no earnedAmount -> ignored
        ]

        let rollup = rollupEarningsByContract(worklogs: worklogs, contracts: [c1, c2])
        XCTAssertEqual(rollup.count, 2)
        // sorted desc by effectiveFrom -> c2 first
        XCTAssertEqual(rollup[0].contract.syncId, "c2")
        XCTAssertEqual(rollup[0].earnedCzk, 1000)
        XCTAssertEqual(rollup[1].contract.syncId, "c1")
        XCTAssertEqual(rollup[1].earnedCzk, 750)
    }

    func testRollupSortsContractsDescByEffectiveFrom() {
        let c1 = contract(syncId: "c1", effectiveFrom: "2026-01-01")
        let c2 = contract(syncId: "c2", effectiveFrom: "2026-06-01")
        let c3 = contract(syncId: "c3", effectiveFrom: "2026-03-01")

        let rollup = rollupEarningsByContract(worklogs: [], contracts: [c1, c2, c3])
        XCTAssertEqual(rollup.map(\.contract.syncId), ["c2", "c3", "c1"])
    }

    // MARK: - sharedMemberCount

    func testSharedMemberCountCountsDistinctProjectIds() {
        let a = contract(syncId: "c1", projectId: 1, effectiveFrom: "2026-01-01", contractGroupId: "grp-1")
        let b = contract(syncId: "c2", projectId: 2, effectiveFrom: "2026-01-01", contractGroupId: "grp-1")
        let c = contract(syncId: "c3", projectId: 1, effectiveFrom: "2026-06-01", contractGroupId: "grp-1") // same project, different row
        let other = contract(syncId: "c4", projectId: 3, effectiveFrom: "2026-01-01", contractGroupId: "grp-2")

        XCTAssertEqual(sharedMemberCount([a, b, c, other], groupId: "grp-1"), 2)
        XCTAssertEqual(sharedMemberCount([a, b, c, other], groupId: "grp-2"), 1)
        XCTAssertEqual(sharedMemberCount([a, b, c, other], groupId: "unknown"), 0)
    }

    // MARK: - rateLabel

    func testRateLabelHourly() {
        let c = contract(syncId: "c1", effectiveFrom: "2026-01-01", rateType: "hourly", rateAmount: 1500)
        XCTAssertEqual(rateLabel(c), "1\u{00A0}500\u{00A0}Kč/h")
    }

    func testRateLabelDaily() {
        let c = contract(syncId: "c1", effectiveFrom: "2026-01-01", rateType: "daily", rateAmount: 8000)
        XCTAssertEqual(rateLabel(c), "8\u{00A0}000\u{00A0}Kč/MD")
    }
}
