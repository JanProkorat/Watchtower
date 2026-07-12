import XCTest
@testable import WatchtowerCore

final class WorkdaysExtraTests: XCTestCase {
    func testHolidayNames2026() {
        let h = czechHolidayNames(2026)
        XCTAssertEqual(h["2026-01-01"], "New Year / Restoration Day")
        XCTAssertEqual(h["2026-04-03"], "Good Friday")
        XCTAssertEqual(h["2026-04-06"], "Easter Monday")
        XCTAssertEqual(h["2026-12-25"], "Christmas Day")
        XCTAssertEqual(czechHolidays(2026), Set(h.keys)) // Set still derived, countWorkdays unaffected
    }
    func testWorkdayDates() {
        // 2026-01-01..2026-01-11: Jan1 holiday, weekends 3/4/10/11 → [02,05,06,07,08,09]
        XCTAssertEqual(workdayDates("2026-01-01", "2026-01-11", []),
                       ["2026-01-02","2026-01-05","2026-01-06","2026-01-07","2026-01-08","2026-01-09"])
        XCTAssertEqual(workdayDates("2026-01-01", "2026-01-11", ["2026-01-06"]).count, 5)
        XCTAssertTrue(workdayDates("2026-01-11", "2026-01-01", []).isEmpty)
    }
}
