import XCTest
@testable import WatchtowerRemote

final class VncKeyMapTests: XCTestCase {
    func testSpecialKeysyms() {
        XCTAssertEqual(VncKeyMap.keysym(for: .returnKey), 0xFF0D)
        XCTAssertEqual(VncKeyMap.keysym(for: .backspace), 0xFF08)
        XCTAssertEqual(VncKeyMap.keysym(for: .tab), 0xFF09)
        XCTAssertEqual(VncKeyMap.keysym(for: .escape), 0xFF1B)
        XCTAssertEqual(VncKeyMap.keysym(for: .left), 0xFF51)
        XCTAssertEqual(VncKeyMap.keysym(for: .up), 0xFF52)
        XCTAssertEqual(VncKeyMap.keysym(for: .right), 0xFF53)
        XCTAssertEqual(VncKeyMap.keysym(for: .down), 0xFF54)
    }

    func testPrintableScalarMapsToCodePoint() {
        XCTAssertEqual(VncKeyMap.keysym(forScalar: Unicode.Scalar("a")), 0x61)
        XCTAssertEqual(VncKeyMap.keysym(forScalar: Unicode.Scalar(" ")), 0x20)
        XCTAssertEqual(VncKeyMap.keysym(forScalar: Unicode.Scalar(0xFF)!), 0xFF)
    }

    func testOutOfRangeScalarReturnsNil() {
        XCTAssertNil(VncKeyMap.keysym(forScalar: Unicode.Scalar(0x1F)!)) // below 0x20
        XCTAssertNil(VncKeyMap.keysym(forScalar: Unicode.Scalar(0x100)!)) // above 0xFF
    }
}
