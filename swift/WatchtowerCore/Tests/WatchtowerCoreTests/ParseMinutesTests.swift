import XCTest
@testable import WatchtowerCore

final class ParseMinutesTests: XCTestCase {
    func testDecimalHours() {
        XCTAssertEqual(parseMinutes("1"), 60)
        XCTAssertEqual(parseMinutes("1.5"), 90)
        XCTAssertEqual(parseMinutes("1,5"), 90)   // comma normalized
    }
    func testDecimalRounds() { XCTAssertEqual(parseMinutes("1.501"), 90) } // 90.06 -> round -> 90
    func testColonForm() {
        XCTAssertEqual(parseMinutes("1:30"), 90)
        XCTAssertEqual(parseMinutes("1:5"), 65)
        XCTAssertEqual(parseMinutes("1:90"), 150) // not clamped to 59
    }
    func testHmForm() {
        XCTAssertEqual(parseMinutes("2h"), 120)
        XCTAssertEqual(parseMinutes("45m"), 45)
        XCTAssertEqual(parseMinutes("1h30m"), 90)
        XCTAssertEqual(parseMinutes("1.5h"), 90)
        XCTAssertEqual(parseMinutes("1h 30m"), 90)
    }
    func testGarbageAndEmpty() {
        XCTAssertNil(parseMinutes(""))
        XCTAssertNil(parseMinutes("   "))
        XCTAssertNil(parseMinutes("abc"))
        XCTAssertNil(parseMinutes("h"))
        XCTAssertNil(parseMinutes("-1"))
    }
    func testNewlineTrimming() {
        XCTAssertEqual(parseMinutes("5\n"), 300)
        XCTAssertEqual(parseMinutes("\n1.5"), 90)
        XCTAssertEqual(parseMinutes("\r\n2h\r\n"), 120)
    }
    func testPathologicalInputDoesNotCrash() {
        let hugeNumeral = String(repeating: "9", count: 400)
        XCTAssertNil(parseMinutes(hugeNumeral))
        XCTAssertNil(parseMinutes(hugeNumeral + "h"))
    }
}
