import XCTest
@testable import WatchtowerBridge

final class SmokeTests: XCTestCase {
    func testModuleLinks() {
        XCTAssertEqual(watchtowerBridgeModuleMarker, "WatchtowerBridge")
    }
}
