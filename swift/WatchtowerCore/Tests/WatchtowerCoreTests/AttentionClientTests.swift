import XCTest
@testable import WatchtowerCore

final class AttentionClientTests: XCTestCase {
    func testReplyInsertEncodesUserRoleSnakeCase() throws {
        let p = AttentionReplyInsert(syncId: "u1", instanceId: "i1", replyTo: "c1",
                                     body: "hi", createdAt: "2026-07-14T10:00:00Z")
        let json = try XCTUnwrap(JSONSerialization.jsonObject(
            with: JSONEncoder().encode(p)) as? [String: String])
        XCTAssertEqual(json["role"], "user")
        XCTAssertEqual(json["sync_id"], "u1")
        XCTAssertEqual(json["instance_id"], "i1")
        XCTAssertEqual(json["reply_to"], "c1")
        XCTAssertEqual(json["body"], "hi")
        XCTAssertEqual(json["created_at"], "2026-07-14T10:00:00Z")
    }
}
