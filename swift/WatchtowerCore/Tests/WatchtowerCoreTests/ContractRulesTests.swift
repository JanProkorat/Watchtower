import XCTest
@testable import WatchtowerCore

final class ContractRulesTests: XCTestCase {
    func testOverlapOpenEnded() {
        XCTAssertTrue(contractsOverlap("2026-01-01", nil, "2026-06-01", nil))
        XCTAssertTrue(contractsOverlap("2026-01-01", "2026-12-31", "2026-06-01", nil))
    }
    func testNoOverlapAdjacent() {
        XCTAssertFalse(contractsOverlap("2026-01-01", "2026-05-31", "2026-06-01", nil))
    }
    func testOverlapTouching() {
        XCTAssertTrue(contractsOverlap("2026-01-01", "2026-06-01", "2026-06-01", nil))
    }
    func testPreviousDayCrossesMonthBoundaryInUTC() {
        XCTAssertEqual(previousDay("2026-06-01"), "2026-05-31")
        XCTAssertEqual(previousDay("2026-01-01"), "2025-12-31")
        XCTAssertEqual(previousDay("2026-03-01"), "2026-02-28")
    }
}
