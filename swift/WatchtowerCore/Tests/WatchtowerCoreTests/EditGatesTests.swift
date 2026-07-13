import XCTest
@testable import WatchtowerCore

final class EditGatesTests: XCTestCase {
    func testCanEditOnlyWhenFresh() {
        XCTAssertTrue(canEdit(.fresh))
        XCTAssertFalse(canEdit(.cached))
        XCTAssertFalse(canEdit(.offline))
        XCTAssertFalse(canEdit(.loading))
    }
    func testCanEditTask() {
        XCTAssertTrue(canEditTask("in_progress"))
        XCTAssertFalse(canEditTask("done"))
    }
}
