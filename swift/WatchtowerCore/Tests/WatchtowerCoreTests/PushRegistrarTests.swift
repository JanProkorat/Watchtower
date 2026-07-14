import XCTest
@testable import WatchtowerCore

final class PushRegistrarTests: XCTestCase {
    func testUpsertPayloadEncodesSnakeCaseWithIosBundleId() throws {
        let payload = PushDeviceUpsert(
            apnsToken: "abc123", platform: "ios", bundleId: "cz.greencode.watchtower.ios")
        let data = try JSONEncoder().encode(payload)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: String])
        XCTAssertEqual(json["apns_token"], "abc123")
        XCTAssertEqual(json["platform"], "ios")
        XCTAssertEqual(json["bundle_id"], "cz.greencode.watchtower.ios")
    }
}
