import XCTest
@testable import WatchtowerCore

final class CzFormatTests: XCTestCase {
    func testCzk() {
        XCTAssertEqual(CzFormat.czk(142500), "142\u{00A0}500\u{00A0}Kč")
        XCTAssertEqual(CzFormat.czk(0), "0\u{00A0}Kč")
        XCTAssertEqual(CzFormat.czk(1234.7), "1\u{00A0}235\u{00A0}Kč") // rounds to 0 frac digits
    }
    func testHours() {
        XCTAssertEqual(CzFormat.hours(90), "1,5\u{00A0}h")
        XCTAssertEqual(CzFormat.hours(60), "1\u{00A0}h")
        XCTAssertEqual(CzFormat.hours(75), "1,25\u{00A0}h")
        XCTAssertEqual(CzFormat.hours(0), "0\u{00A0}h")
    }
    func testDateCz() {
        XCTAssertEqual(CzFormat.dateCz("2026-06-07"), "7. 6. 2026")
        XCTAssertEqual(CzFormat.dateCz("2026-12-25"), "25. 12. 2026")
    }
    func testCzechMonthLabel() {
        XCTAssertEqual(CzFormat.czechMonthLabel("2026-06"), "Červen 2026")
        XCTAssertEqual(CzFormat.czechMonthLabel("2025-01"), "Leden 2025")
    }
    func testAddMonths() {
        XCTAssertEqual(CzFormat.addMonths("2026-01", -1), "2025-12")
        XCTAssertEqual(CzFormat.addMonths("2026-12", 1), "2027-01")
        XCTAssertEqual(CzFormat.addMonths("2026-06", 0), "2026-06")
        XCTAssertEqual(CzFormat.addMonths("2026-03", -5), "2025-10")
    }
}
