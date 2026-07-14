import XCTest
@testable import WatchtowerCore

final class PushTokenFormatTests: XCTestCase {
    func testHexEncodeLowercase() {
        let data = Data([0x00, 0x0f, 0xab, 0xff])
        XCTAssertEqual(hexEncode(data), "000fabff")
    }
}
