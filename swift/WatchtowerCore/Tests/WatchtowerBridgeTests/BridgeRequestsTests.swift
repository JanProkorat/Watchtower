import XCTest
import ComposableArchitecture
@testable import WatchtowerBridge

final class BridgeRequestsTests: XCTestCase {
    func testInvokeEncodesKindAndDecodesResponse() async throws {
        let captured = LockIsolated<(kind: String, payload: Data)?>(nil)
        var client = BridgeClient()
        client.send = { kind, payload in
            captured.setValue((kind, payload))
            return Data(
                #"{"instances":[{"id":"i1","cwd":"/Users/jan/x","status":"working","lastActivityAt":1752566400000,"kind":"managed","taskId":null}]}"#
                    .utf8
            )
        }

        let res = try await client.invoke(ListInstancesRequest())

        XCTAssertEqual(captured.value?.kind, "listInstances")
        XCTAssertEqual(String(decoding: captured.value!.payload, as: UTF8.self), "{}")
        XCTAssertEqual(res.instances, [
            BridgeInstance(
                id: "i1", cwd: "/Users/jan/x", status: "working",
                lastActivityAt: 1_752_566_400_000, kind: "managed", taskId: nil
            ),
        ])
    }

    func testInvokeWrapsDecodeFailureAsBadResponse() async {
        var client = BridgeClient()
        client.send = { _, _ in Data(#"{"unexpected":"shape"}"#.utf8) }
        do {
            _ = try await client.invoke(ListInstancesRequest())
            XCTFail("expected badResponse")
        } catch {
            XCTAssertEqual(error as? BridgeError, .badResponse)
        }
    }

    func testPushKinds() {
        XCTAssertEqual(BridgePush.stateChanged, "stateChanged")
    }
}
