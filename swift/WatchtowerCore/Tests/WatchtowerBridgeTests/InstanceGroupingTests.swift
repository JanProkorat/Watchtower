import XCTest
@testable import WatchtowerBridge

final class InstanceGroupingTests: XCTestCase {
    private func inst(_ id: String, cwd: String, status: String = "working") -> Instance {
        Instance(id: id, cwd: cwd, status: status, lastActivityAt: 0, kind: "claude", taskId: nil)
    }
    private func proj(_ id: Int, _ name: String, _ path: String?) -> ProjectSummary {
        ProjectSummary(id: id, name: name, folderPath: path)
    }

    func testGroupsByFolderPathMatch() {
        let groups = groupInstancesByProject(
            [inst("a", cwd: "/x"), inst("b", cwd: "/y"), inst("c", cwd: "/x")],
            projects: [proj(1, "X", "/x"), proj(2, "Y", "/y")]
        )
        XCTAssertEqual(groups.map(\.label), ["X", "Y"])
        XCTAssertEqual(groups[0].instanceIds, ["a", "c"])
        XCTAssertEqual(groups[1].instanceIds, ["b"])
    }

    func testUnmatchedGoToOtherGroupLast() {
        let groups = groupInstancesByProject(
            [inst("a", cwd: "/x"), inst("z", cwd: "/nowhere")],
            projects: [proj(1, "X", "/x")]
        )
        XCTAssertEqual(groups.map(\.label), ["X", "Other"])
        XCTAssertNil(groups[1].projectId)
        XCTAssertEqual(groups[1].instanceIds, ["z"])
    }

    func testEmptyProjectGroupsOmitted() {
        let groups = groupInstancesByProject(
            [inst("a", cwd: "/x")],
            projects: [proj(1, "X", "/x"), proj(2, "Y", "/y")]
        )
        XCTAssertEqual(groups.map(\.label), ["X"])
    }

    func testProjectWithNilFolderPathNeverMatches() {
        let groups = groupInstancesByProject(
            [inst("a", cwd: "/x")],
            projects: [proj(1, "NoPath", nil)]
        )
        XCTAssertEqual(groups.map(\.label), ["Other"])
    }

    func testAttentionRespectsAckAndStatus() {
        let insts = [inst("a", cwd: "/x", status: "waiting-permission"),
                     inst("b", cwd: "/x", status: "working"),
                     inst("c", cwd: "/x", status: "crashed")]
        XCTAssertEqual(acknowledgedNeedingAttention(instances: insts, acked: []), ["a", "c"])
        XCTAssertEqual(acknowledgedNeedingAttention(instances: insts, acked: ["a"]), ["c"])
    }

    func testReconcileDropsAckWhenInstanceLeavesAttention() {
        let insts = [inst("a", cwd: "/x", status: "working")] // no longer needs attention
        XCTAssertEqual(reconcileAcked(["a", "gone"], instances: insts), [])
    }

    func testReconcileKeepsAckWhileStillNeedingAttention() {
        let insts = [inst("a", cwd: "/x", status: "waiting-input")]
        XCTAssertEqual(reconcileAcked(["a"], instances: insts), ["a"])
    }

    func testApplyAuthBlockAddRemoveAndNoop() {
        XCTAssertEqual(applyAuthBlock([], instanceId: "a", blocked: true), ["a"])
        XCTAssertEqual(applyAuthBlock(["a"], instanceId: "a", blocked: false), [])
        // no-op returns the same set
        XCTAssertEqual(applyAuthBlock(["a"], instanceId: "a", blocked: true), ["a"])
        XCTAssertEqual(applyAuthBlock([], instanceId: "a", blocked: false), [])
    }
}
