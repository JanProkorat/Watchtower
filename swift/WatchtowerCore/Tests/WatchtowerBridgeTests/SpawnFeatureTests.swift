import XCTest
import ComposableArchitecture
@testable import WatchtowerBridge

/// Mirrors SpawnInstanceRequest's wire shape for test-side decoding (the
/// production type is Encodable-only — invoke() never decodes its own request).
private struct CapturedSpawnPayload: Decodable, Equatable {
    let cwd: String
    let instanceKind: String
}

private struct CapturedRestartPayload: Decodable, Equatable {
    let instanceId: String
}

@MainActor
final class SpawnFeatureTests: XCTestCase {
    private let project = ProjectSummary(id: 1, name: "Proj", folderPath: "/x")

    // MARK: - spawnTapped

    func testSpawnTappedInvokesWithSelectedProjectPathAndKindThenSucceeds() async {
        let captured = LockIsolated<(kind: String, payload: Data)?>(nil)
        var state = SpawnFeature.State(projects: [project])
        state.selectedProjectId = 1
        state.instanceKind = "shell"
        let store = TestStore(initialState: state) {
            SpawnFeature()
        } withDependencies: {
            $0.bridge.send = { kind, payload in
                captured.setValue((kind, payload))
                return Data(#"{"instanceId":"new-id","error":null}"#.utf8)
            }
        }

        await store.send(.spawnTapped) {
            $0.isSubmitting = true
            $0.errorMessage = nil
        }
        await store.receive(\.spawned) {
            $0.isSubmitting = false
        }

        XCTAssertEqual(captured.value?.kind, "spawnInstance")
        let decoded = try? JSONDecoder().decode(CapturedSpawnPayload.self, from: captured.value!.payload)
        XCTAssertEqual(decoded, CapturedSpawnPayload(cwd: "/x", instanceKind: "shell"))
    }

    func testSpawnTappedServerDeclinedSetsErrorMessageAndDoesNotSpawn() async {
        var state = SpawnFeature.State(projects: [project])
        state.selectedProjectId = 1
        let store = TestStore(initialState: state) {
            SpawnFeature()
        } withDependencies: {
            $0.bridge.send = { _, _ in Data(#"{"instanceId":null,"error":"no such project"}"#.utf8) }
        }

        await store.send(.spawnTapped) {
            $0.isSubmitting = true
            $0.errorMessage = nil
        }
        await store.receive(\.spawnFailed) {
            $0.errorMessage = "no such project"
            $0.isSubmitting = false
        }
    }

    func testSpawnTappedTransportErrorSurfacesGenericFailure() async {
        var state = SpawnFeature.State(projects: [project])
        state.selectedProjectId = 1
        let store = TestStore(initialState: state) {
            SpawnFeature()
        } withDependencies: {
            $0.bridge.send = { _, _ in throw BridgeError.disconnected }
        }

        await store.send(.spawnTapped) {
            $0.isSubmitting = true
            $0.errorMessage = nil
        }
        await store.receive(\.spawnFailed) {
            $0.errorMessage = "Spawn failed"
            $0.isSubmitting = false
        }
    }

    func testSpawnTappedWithoutSelectedProjectSetsErrorAndDoesNotInvoke() async {
        // Default state has no selectedProjectId. Not stubbing bridge.send at all —
        // the @DependencyClient endpoint fails the test if the guard doesn't short-circuit.
        let store = TestStore(initialState: SpawnFeature.State(projects: [project])) {
            SpawnFeature()
        }
        await store.send(.spawnTapped) {
            $0.errorMessage = "Select a project"
        }
    }

    func testSpawnTappedWithNonSpawnableSelectedProjectSetsError() async {
        let noPath = ProjectSummary(id: 2, name: "NoPath", folderPath: nil)
        var state = SpawnFeature.State(projects: [noPath])
        state.selectedProjectId = 2
        let store = TestStore(initialState: state) {
            SpawnFeature()
        }
        await store.send(.spawnTapped) {
            $0.errorMessage = "Select a project"
        }
    }

    // MARK: - restartTapped

    func testRestartTappedInvokesAndSucceeds() async {
        let captured = LockIsolated<(kind: String, payload: Data)?>(nil)
        let store = TestStore(initialState: SpawnFeature.State()) {
            SpawnFeature()
        } withDependencies: {
            $0.bridge.send = { kind, payload in
                captured.setValue((kind, payload))
                return Data(#"{"ok":true}"#.utf8)
            }
        }

        await store.send(.restartTapped("inst-1")) {
            $0.isSubmitting = true
            $0.errorMessage = nil
        }
        await store.receive(\.spawned) {
            $0.isSubmitting = false
        }

        XCTAssertEqual(captured.value?.kind, "restartInstance")
        let decoded = try? JSONDecoder().decode(CapturedRestartPayload.self, from: captured.value!.payload)
        XCTAssertEqual(decoded, CapturedRestartPayload(instanceId: "inst-1"))
    }

    func testRestartTappedServerFalseOkSurfacesFailure() async {
        let store = TestStore(initialState: SpawnFeature.State()) {
            SpawnFeature()
        } withDependencies: {
            $0.bridge.send = { _, _ in Data(#"{"ok":false}"#.utf8) }
        }

        await store.send(.restartTapped("inst-1")) {
            $0.isSubmitting = true
            $0.errorMessage = nil
        }
        await store.receive(\.spawnFailed) {
            $0.errorMessage = "Restart failed"
            $0.isSubmitting = false
        }
    }

    // MARK: - derived state

    func testSpawnableProjectsFiltersMissingFolderPath() {
        let noPath = ProjectSummary(id: 2, name: "NoPath", folderPath: nil)
        let state = SpawnFeature.State(projects: [project, noPath])
        XCTAssertEqual(state.spawnableProjects.map(\.id), [1])
    }

    func testRestartableExcludesLiveInstancesInSelectedProjectFolder() {
        let working = Instance(id: "a", cwd: "/x", status: "working", lastActivityAt: 0, kind: "claude", taskId: nil)
        let idle = Instance(id: "b", cwd: "/x", status: "idle", lastActivityAt: 0, kind: "claude", taskId: nil)
        let otherFolder = Instance(id: "c", cwd: "/y", status: "idle", lastActivityAt: 0, kind: "claude", taskId: nil)
        var state = SpawnFeature.State(projects: [project], instances: [working, idle, otherFolder])
        state.selectedProjectId = 1
        XCTAssertEqual(state.restartable.map(\.id), ["b"])
    }

    func testRestartableIsEmptyWithNoSelectedProject() {
        let idle = Instance(id: "b", cwd: "/x", status: "idle", lastActivityAt: 0, kind: "claude", taskId: nil)
        let state = SpawnFeature.State(projects: [project], instances: [idle])
        XCTAssertEqual(state.restartable, [])
    }

    // MARK: - simple reducer actions

    func testProjectSelectedSetsIdAndClearsError() async {
        var state = SpawnFeature.State(projects: [project])
        state.errorMessage = "Select a project"
        let store = TestStore(initialState: state) { SpawnFeature() }
        await store.send(.projectSelected(1)) {
            $0.selectedProjectId = 1
            $0.errorMessage = nil
        }
    }

    func testKindSelectedSetsKindAndClearsError() async {
        var state = SpawnFeature.State()
        state.errorMessage = "Select a project"
        let store = TestStore(initialState: state) { SpawnFeature() }
        await store.send(.kindSelected("shell")) {
            $0.instanceKind = "shell"
            $0.errorMessage = nil
        }
    }

    func testDismissedResetsTransientFields() async {
        var state = SpawnFeature.State()
        state.errorMessage = "boom"
        state.isSubmitting = true
        let store = TestStore(initialState: state) { SpawnFeature() }
        await store.send(.dismissed) {
            $0.errorMessage = nil
            $0.isSubmitting = false
        }
    }
}
