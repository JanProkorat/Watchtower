import XCTest
import ComposableArchitecture
@testable import WatchtowerBridge

@MainActor
final class InstancesFeatureTests: XCTestCase {
    private func listPayload(_ ids: [String], cwd: String = "/x") -> Data {
        let items = ids.map { #"{"id":"\#($0)","cwd":"\#(cwd)","status":"working","lastActivityAt":0,"kind":"claude","taskId":null}"# }
        return Data(#"{"instances":[\#(items.joined(separator: ","))]}"#.utf8)
    }

    func testOnAppearLoadsProjectsAndInstances() async {
        let store = TestStore(initialState: InstancesFeature.State()) { InstancesFeature() } withDependencies: {
            $0.bridge.statusStream = { .finished }
            $0.bridge.pushes = { _ in .finished }
            $0.bridge.send = { kind, _ in
                switch kind {
                case "projects:list": return Data(#"{"projects":[{"id":1,"name":"X","folderPath":"/x"}]}"#.utf8)
                case "listInstances": return self.listPayload(["a"])
                default: return Data("{}".utf8)
                }
            }
        }
        await store.send(.onAppear)
        await store.receive(\.projectsLoaded) { $0.projects = [ProjectSummary(id: 1, name: "X", folderPath: "/x")] }
        await store.receive(\.instancesLoaded) {
            $0.instances = [Instance(id: "a", cwd: "/x", status: "working", lastActivityAt: 0, kind: "claude", taskId: nil)]
        }
        XCTAssertEqual(store.state.groups.map(\.label), ["X"])
        await store.send(.onAppear).finish() // drain long-running push subscriptions
    }

    func testInstanceSelectedAcks() async {
        let store = TestStore(
            initialState: InstancesFeature.State(
                instances: [Instance(id: "a", cwd: "/x", status: "waiting-input", lastActivityAt: 0, kind: "claude", taskId: nil)]
            )
        ) { InstancesFeature() }
        XCTAssertEqual(store.state.attentionIds, ["a"])
        await store.send(.instanceSelected("a")) { $0.selectedInstanceId = "a"; $0.acked = ["a"] }
        XCTAssertEqual(store.state.attentionIds, []) // acked clears the dot
    }

    func testAuthBlockFolds() async {
        let store = TestStore(initialState: InstancesFeature.State()) { InstancesFeature() }
        await store.send(.authBlockChanged(instanceId: "a", blocked: true)) { $0.blocked = ["a"] }
        await store.send(.authBlockChanged(instanceId: "a", blocked: false)) { $0.blocked = [] }
    }
}
