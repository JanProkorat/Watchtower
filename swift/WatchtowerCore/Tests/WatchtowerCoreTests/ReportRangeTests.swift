import XCTest
@testable import WatchtowerCore

final class ReportRangeTests: XCTestCase {
    func testResolvePreset() {
        XCTAssertEqual(resolvePreset(.d7, today: "2026-06-30", earliest: nil).from, "2026-06-24")
        XCTAssertEqual(resolvePreset(.d30, today: "2026-06-30", earliest: nil).from, "2026-06-01")
        XCTAssertEqual(resolvePreset(.month, today: "2026-06-15", earliest: nil).from, "2026-06-01")
        XCTAssertEqual(resolvePreset(.year, today: "2026-06-15", earliest: nil).from, "2026-01-01")
        XCTAssertEqual(resolvePreset(.all, today: "2026-06-15", earliest: "2025-03-02").from, "2025-03-02")
        XCTAssertEqual(resolvePreset(.all, today: "2026-06-15", earliest: nil).from, "2026-06-15")
    }
    func testSpanDaysInclusive() {
        XCTAssertEqual(spanDays("2026-06-01", "2026-06-01"), 1)
        XCTAssertEqual(spanDays("2026-06-01", "2026-06-30"), 30)
    }
    func testDefaultAndClamp() {
        XCTAssertEqual(defaultGranularity(.year), .month)
        XCTAssertEqual(defaultGranularity(.d7), .day)
        // 366-day range with .day → clamps to .week
        XCTAssertEqual(clampGranularity(.day, from: "2025-01-01", to: "2026-01-01"), .week)
        XCTAssertEqual(clampGranularity(.day, from: "2026-06-01", to: "2026-06-30"), .day) // 30 ≤ 92
        // Non-cascading (JS parity): a .day input NEVER reaches the week→month check.
        // span > 1100 with .day input stays .week, does NOT become .month.
        XCTAssertEqual(clampGranularity(.day, from: "2020-01-01", to: "2026-06-15"), .week)
        // A .week INPUT with span > 1100 becomes .month.
        XCTAssertEqual(clampGranularity(.week, from: "2020-01-01", to: "2026-06-15"), .month)
        // A .week input with span ≤ 1100 stays .week.
        XCTAssertEqual(clampGranularity(.week, from: "2026-01-01", to: "2026-02-01"), .week)
    }
}
