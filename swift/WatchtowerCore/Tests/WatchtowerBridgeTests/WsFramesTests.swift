import XCTest
@testable import WatchtowerBridge

final class WsFramesTests: XCTestCase {
    func testComposeRequestFrame() throws {
        let payload = Data(#"{"instanceId":"abc"}"#.utf8)
        let raw = try composeRequestFrame(id: "c1", kind: "terminalAttach", payload: payload)
        let obj = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
        XCTAssertEqual(obj["id"] as? String, "c1")
        XCTAssertEqual(obj["kind"] as? String, "terminalAttach")
        let inner = try XCTUnwrap(obj["payload"] as? [String: Any])
        XCTAssertEqual(inner["instanceId"] as? String, "abc")
    }

    func testDecodeResponseWithPayload() throws {
        let frame = try decodeIncomingFrame(#"{"id":"c3","kind":"listInstances","payload":{"instances":[]}}"#)
        guard case let .response(id, payload, error) = frame else { return XCTFail("expected response") }
        XCTAssertEqual(id, "c3")
        XCTAssertNil(error)
        let obj = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(payload)) as? [String: Any])
        XCTAssertNotNil(obj["instances"])
    }

    func testDecodeResponseWithError() throws {
        let frame = try decodeIncomingFrame(#"{"id":"c9","kind":"spawnInstance","error":"no such project"}"#)
        guard case let .response(id, payload, error) = frame else { return XCTFail("expected response") }
        XCTAssertEqual(id, "c9")
        XCTAssertNil(payload)
        XCTAssertEqual(error, "no such project")
    }

    func testDecodePushFrame() throws {
        let frame = try decodeIncomingFrame(#"{"push":true,"kind":"stateChanged","payload":{"instanceId":"i1"}}"#)
        guard case let .push(kind, payload) = frame else { return XCTFail("expected push") }
        XCTAssertEqual(kind, "stateChanged")
        XCTAssertNotNil(payload)
    }

    func testDecodeGarbageThrows() {
        XCTAssertThrowsError(try decodeIncomingFrame("not json"))
        XCTAssertThrowsError(try decodeIncomingFrame(#"{"no":"kind"}"#))
        // Response frame without an id cannot be matched to a pending request.
        XCTAssertThrowsError(try decodeIncomingFrame(#"{"kind":"listInstances","payload":{}}"#))
    }

    func testDecodeScalarPayload() throws {
        // Payloads are usually objects, but the codec must not assume it.
        let frame = try decodeIncomingFrame(#"{"push":true,"kind":"x","payload":42}"#)
        guard case let .push(_, payload) = frame else { return XCTFail("expected push") }
        XCTAssertEqual(String(decoding: try XCTUnwrap(payload), as: UTF8.self), "42")
    }
}
