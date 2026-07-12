import XCTest
@testable import WatchtowerCore

final class TimeOffModelTests: XCTestCase {
    func testStructureAndUpcoming() {
        let daysOff = [DayOffRow(date: "2026-06-15", kind: "vacation", syncId: "v1"),
                       DayOffRow(date: "2026-07-06", kind: "weird", syncId: "w1")] // normalizes to .other
        let m = buildTimeOffModel(focusMonth: "2026-06", daysOff: daysOff, today: "2026-06-01")
        XCTAssertEqual(m.months.map(\.month), ["2026-05","2026-06","2026-07"])
        XCTAssertEqual(m.months[1].weeks.count * 7, m.months[1].weeks.flatMap { $0 }.count) // full weeks
        // 2026-06-01 is Monday → focus month first row starts with the 1st (no leading pad) — sanity: first non-nil day is "2026-06-01"
        XCTAssertEqual(m.months[1].weeks.first?.first(where: { $0.date != nil })?.date, "2026-06-01")
        // upcoming: user vacation 06-15 present, kind .vacation, note nil; weird→.other
        XCTAssertTrue(m.upcoming.contains { $0.date == "2026-06-15" && $0.kind == .vacation && $0.note == nil })
        XCTAssertTrue(m.upcoming.contains { $0.date == "2026-07-06" && $0.kind == .other })
        // a holiday >= today shows with its name as note (e.g. Cyril & Methodius 2026-07-05)
        XCTAssertTrue(m.upcoming.contains { $0.date == "2026-07-05" && $0.kind == .holiday && $0.note == "Cyril & Methodius Day" })
        XCTAssertTrue(m.upcoming.count <= 30)
        // upcoming ascending
        XCTAssertEqual(m.upcoming.map(\.date), m.upcoming.map(\.date).sorted())
    }
}
