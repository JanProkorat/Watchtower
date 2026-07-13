import XCTest
@testable import WatchtowerCore

final class WorklogBillingTests: XCTestCase {
    private let c100 = ContractLite(effectiveFrom: "2026-01-01", rateType: "hourly", rateAmount: 100, hoursPerDay: 8)
    private let c200 = ContractLite(effectiveFrom: "2026-06-01", rateType: "hourly", rateAmount: 200, hoursPerDay: 8)

    func testEffectiveMinutesPrefersReportedIncludingZero() {
        XCTAssertEqual(computeWorklogBilling(minutes: 90, reportedMinutes: 0, workDate: "2026-03-01", contracts: [c100]).effectiveMinutes, 0)
        XCTAssertEqual(computeWorklogBilling(minutes: 90, reportedMinutes: nil, workDate: "2026-03-01", contracts: [c100]).effectiveMinutes, 90)
    }

    func testResolveContractInclusiveLowerBoundary() {
        XCTAssertEqual(resolveContract(workDate: "2026-05-31", contracts: [c100, c200])?.rateAmount, 100)
        XCTAssertEqual(resolveContract(workDate: "2026-06-01", contracts: [c100, c200])?.rateAmount, 200)
    }

    func testResolveContractFirstEncounteredWinsOnTie() {
        let a = ContractLite(effectiveFrom: "2026-01-01", rateType: "hourly", rateAmount: 1, hoursPerDay: 8)
        let b = ContractLite(effectiveFrom: "2026-01-01", rateType: "hourly", rateAmount: 2, hoursPerDay: 8)
        XCTAssertEqual(resolveContract(workDate: "2026-02-01", contracts: [a, b])?.rateAmount, 1)
    }

    func testNoContractReturnsNilRateAndAmount() {
        let r = computeWorklogBilling(minutes: 60, reportedMinutes: nil, workDate: "2025-01-01", contracts: [c100])
        XCTAssertEqual(r.effectiveMinutes, 60)
        XCTAssertNil(r.resolvedRate)
        XCTAssertNil(r.earnedAmount)
    }

    func testHourlyEarned() {
        let r = computeWorklogBilling(minutes: 90, reportedMinutes: nil, workDate: "2026-03-01", contracts: [c100])
        XCTAssertEqual(r.earnedAmount, 150)
        XCTAssertEqual(r.resolvedRate, 100)
    }

    func testDailyEarned() {
        let daily = ContractLite(effectiveFrom: "2026-01-01", rateType: "daily", rateAmount: 4000, hoursPerDay: 8)
        let r = computeWorklogBilling(minutes: 240, reportedMinutes: nil, workDate: "2026-03-01", contracts: [daily])
        XCTAssertEqual(r.earnedAmount, 2000)
    }
}
