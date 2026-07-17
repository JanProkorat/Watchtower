import XCTest
@testable import WatchtowerBridge

final class InstanceRequestsTests: XCTestCase {
    private func jsonObject(_ data: Data) -> [String: Any]? {
        (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    func testKindsAreCorrect() {
        XCTAssertEqual(RemoveInstanceRequest.kind, "removeInstance")
        XCTAssertEqual(SpawnInstanceRequest.kind, "spawnInstance")
        XCTAssertEqual(RestartInstanceRequest.kind, "restartInstance")
        XCTAssertEqual(TerminalAttachRequest.kind, "terminalAttach")
        XCTAssertEqual(PtyWriteRequest.kind, "ptyWrite")
        XCTAssertEqual(PtyResizeRequest.kind, "ptyResize")
        XCTAssertEqual(TerminalFocusRequest.kind, "terminalFocus")
        XCTAssertEqual(ProjectsListRequest.kind, "projects:list")
        XCTAssertEqual(BridgePush.ptyData, "ptyData")
        XCTAssertEqual(BridgePush.authBlock, "authBlock")
    }

    func testSpawnEncodesCwdAndKind() throws {
        let data = try JSONEncoder().encode(SpawnInstanceRequest(cwd: "/x", instanceKind: "claude"))
        let obj = try XCTUnwrap(jsonObject(data))
        XCTAssertEqual(obj["cwd"] as? String, "/x")
        XCTAssertEqual(obj["instanceKind"] as? String, "claude")
        XCTAssertNil(obj["args"]) // omitted
    }

    func testPtyWriteEncodesFields() throws {
        let data = try JSONEncoder().encode(PtyWriteRequest(instanceId: "i1", data: "ls\n"))
        let obj = try XCTUnwrap(jsonObject(data))
        XCTAssertEqual(obj["instanceId"] as? String, "i1")
        XCTAssertEqual(obj["data"] as? String, "ls\n")
    }

    func testTerminalAttachResponseDecodes() throws {
        let json = #"{"data":"[32mhi[0m","cols":120,"rows":30}"#
        let res = try JSONDecoder().decode(TerminalAttachRequest.Response.self, from: Data(json.utf8))
        XCTAssertEqual(res.cols, 120); XCTAssertEqual(res.rows, 30)
        XCTAssertFalse(res.data.isEmpty)
    }

    func testSpawnResponseDecodesNullAndError() throws {
        let ok = try JSONDecoder().decode(SpawnInstanceRequest.Response.self,
                                          from: Data(#"{"instanceId":"i9"}"#.utf8))
        XCTAssertEqual(ok.instanceId, "i9"); XCTAssertNil(ok.error)
        let fail = try JSONDecoder().decode(SpawnInstanceRequest.Response.self,
                                            from: Data(#"{"instanceId":null,"error":"boom"}"#.utf8))
        XCTAssertNil(fail.instanceId); XCTAssertEqual(fail.error, "boom")
    }

    func testRestartResponseAllowsFalse() throws {
        let r = try JSONDecoder().decode(RestartInstanceRequest.Response.self, from: Data(#"{"ok":false}"#.utf8))
        XCTAssertFalse(r.ok)
    }

    func testProjectsListDecodesSubset() throws {
        // Server sends extra fields; only id/name/folderPath must decode.
        let json = #"{"projects":[{"id":1,"name":"X","folderPath":"/x","kind":"work","archived":false}]}"#
        let res = try JSONDecoder().decode(ProjectsListRequest.Response.self, from: Data(json.utf8))
        XCTAssertEqual(res.projects, [ProjectDTO(id: 1, name: "X", folderPath: "/x")])
    }

    func testPushPayloadsDecode() throws {
        let pd = try JSONDecoder().decode(PtyDataPush.self, from: Data(#"{"instanceId":"i1","chunk":"abc"}"#.utf8))
        XCTAssertEqual(pd, PtyDataPush(instanceId: "i1", chunk: "abc"))
        let ab = try JSONDecoder().decode(AuthBlockPush.self, from: Data(#"{"instanceId":"i1","blocked":true,"reason":"saml"}"#.utf8))
        XCTAssertEqual(ab, AuthBlockPush(instanceId: "i1", blocked: true, reason: "saml"))
        let sc = try JSONDecoder().decode(StateChangedPush.self, from: Data(#"{"instanceId":"i1","status":"working"}"#.utf8))
        XCTAssertEqual(sc, StateChangedPush(instanceId: "i1", status: "working"))
    }
}
