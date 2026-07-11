import XCTest
@testable import WatchtowerCore

final class SmokeTests: XCTestCase {
    func testPackageName() {
        XCTAssertEqual(WatchtowerCore.name, "WatchtowerCore")
    }
}
