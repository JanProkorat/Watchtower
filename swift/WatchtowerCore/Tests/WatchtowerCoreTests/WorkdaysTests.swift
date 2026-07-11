import XCTest
@testable import WatchtowerCore

final class WorkdaysTests: XCTestCase {
    func testHolidays2026() {
        let h = czechHolidays(2026)
        // Fixed
        XCTAssertTrue(h.contains("2026-01-01"))
        XCTAssertTrue(h.contains("2026-05-01"))
        XCTAssertTrue(h.contains("2026-12-25"))
        XCTAssertTrue(h.contains("2026-12-26"))
        // Easter 2026 = Sun Apr 5 → Good Friday Apr 3, Easter Monday Apr 6
        XCTAssertTrue(h.contains("2026-04-03"))
        XCTAssertTrue(h.contains("2026-04-06"))
        XCTAssertFalse(h.contains("2026-04-05")) // Easter Sunday itself is not a listed state holiday
    }
    func testCountWorkdays() {
        // 2026-01-01..2026-01-11: Jan1=Thu(New Year holiday), 2=Fri, 3/4=weekend,
        // 5-9=Mon-Fri, 10/11=weekend. Workdays = Jan2 + Jan5..9 = 6.
        XCTAssertEqual(countWorkdays("2026-01-01", "2026-01-11", []), 6)
        // Exclude Jan 6 as a user day-off → 5.
        XCTAssertEqual(countWorkdays("2026-01-01", "2026-01-11", ["2026-01-06"]), 5)
        // Reversed range → 0.
        XCTAssertEqual(countWorkdays("2026-01-11", "2026-01-01", []), 0)
        // Single non-holiday weekday.
        XCTAssertEqual(countWorkdays("2026-01-05", "2026-01-05", []), 1)
    }
}
