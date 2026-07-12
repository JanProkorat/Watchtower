import XCTest
@testable import WatchtowerCore

final class PaletteTests: XCTestCase {
    func testHexParsesToComponents() throws {
        let c = try XCTUnwrap(hexRGB("#7c6df0"))
        XCTAssertEqual(c.red, 0x7c / 255.0, accuracy: 0.001)
        XCTAssertEqual(c.green, 0x6d / 255.0, accuracy: 0.001)
        XCTAssertEqual(c.blue, 0xf0 / 255.0, accuracy: 0.001)
    }

    func testHexAcceptsNoHashPrefix() {
        XCTAssertEqual(hexRGB("7c6df0")?.red, hexRGB("#7c6df0")?.red)
    }

    func testMalformedHexReturnsNil() {
        XCTAssertNil(hexRGB("#zzzzzz"))  // non-hex
        XCTAssertNil(hexRGB("#12345"))   // wrong length
        XCTAssertNil(hexRGB(""))         // empty
    }
}
