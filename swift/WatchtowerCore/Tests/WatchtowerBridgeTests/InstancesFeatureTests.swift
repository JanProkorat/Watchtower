import XCTest
import ComposableArchitecture
@testable import WatchtowerBridge

@MainActor
final class InstancesFeatureTests: XCTestCase {
    private func listPayload(_ ids: [String], cwd: String = "/x") -> Data {
        let items = ids.map { #"{"id":"\#($0)","cwd":"\#(cwd)","status":"working","lastActivityAt":0,"kind":"claude","taskId":null}"# }
        return Data(#"{"instances":[\#(items.joined(separator: ","))]}"#.utf8)
    }

    func testOnAppearLoadsProjectsInstancesAndSeedsDefaultTiledLayout() async {
        let saveCalls = LockIsolated<[WorkspaceState]>([])
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
            $0.workspaceLayoutStore.load = { [:] }
            $0.workspaceLayoutStore.save = { layouts in saveCalls.withValue { $0.append(layouts) } }
        }
        await store.send(.onAppear)
        // layoutsLoaded([:]) is a no-op here (state.layouts is already [:] and
        // no group is known yet to seed) — nothing to assert in the closure.
        await store.receive(\.layoutsLoaded)
        await store.receive(\.projectsLoaded) { $0.projects = [ProjectSummary(id: 1, name: "X", folderPath: "/x")] }
        await store.receive(\.instancesLoaded) {
            $0.instances = [Instance(id: "a", cwd: "/x", status: "working", lastActivityAt: 0, kind: "claude", taskId: nil)]
            // Active group defaults to the first (only) group; its layout is
            // seeded because none was persisted — tiled default == a single
            // leaf here (one instance), same shape as defaultTabLayout.
            $0.activeGroupId = "1"
            $0.layouts = ["1": defaultTabLayout(instanceId: "a")]
            $0.selectedInstanceId = "a"
        }
        XCTAssertEqual(store.state.groups.map(\.label), ["X"])
        XCTAssertEqual(saveCalls.value.count, 1)
        await store.send(.onAppear).finish() // drain long-running push subscriptions
    }

    func testLayoutsLoadedSeedsActiveGroupWhenInstancesAlreadyKnown() async {
        let saveCalls = LockIsolated<[WorkspaceState]>([])
        let initial = InstancesFeature.State(
            instances: [Instance(id: "a", cwd: "/x", status: "idle", lastActivityAt: 0, kind: "claude", taskId: nil)]
        )
        let store = TestStore(initialState: initial) { InstancesFeature() } withDependencies: {
            $0.workspaceLayoutStore.save = { layouts in saveCalls.withValue { $0.append(layouts) } }
        }
        await store.send(.layoutsLoaded([:])) {
            $0.layouts = ["__other__": defaultTabLayout(instanceId: "a")]
            $0.activeGroupId = "__other__"
            $0.selectedInstanceId = "a"
        }
        XCTAssertEqual(saveCalls.value.count, 1)
    }

    /// Regression: relaunching with a persisted multi-pane layout must land
    /// `selectedInstanceId` on the previously-focused instance right away —
    /// not `nil` until the user taps a pane. Covers the restore branch of
    /// `seedActiveGroupIfNeeded` (layout already present — no fresh seed).
    func testLayoutsLoadedRestoresSelectedInstanceIdFromPersistedFocus() async {
        let saveCalls = LockIsolated<[WorkspaceState]>([])
        let initial = InstancesFeature.State(
            instances: [
                Instance(id: "a", cwd: "/x", status: "idle", lastActivityAt: 0, kind: "claude", taskId: nil),
                Instance(id: "b", cwd: "/x", status: "idle", lastActivityAt: 0, kind: "claude", taskId: nil),
            ]
        )
        let persisted: WorkspaceState = ["__other__": tiledDefaultLayout(instanceIds: ["a", "b"], focusedInstanceId: "b")]
        let store = TestStore(initialState: initial) { InstancesFeature() } withDependencies: {
            $0.workspaceLayoutStore.save = { layouts in saveCalls.withValue { $0.append(layouts) } }
        }
        await store.send(.layoutsLoaded(persisted)) {
            $0.layouts = persisted
            $0.activeGroupId = "__other__"
            $0.selectedInstanceId = "b" // restored from persisted focusedLeafId "d-b", not nil
        }
        // The layout already existed (restored, not freshly seeded) — no
        // extra save should fire.
        XCTAssertEqual(saveCalls.value.count, 0)
    }

    func testInstanceSelectedAcksAndFocusesLeafInActiveGroupLayout() async {
        let saveCalls = LockIsolated<[WorkspaceState]>([])
        var initial = InstancesFeature.State(
            instances: [
                Instance(id: "a", cwd: "/x", status: "waiting-input", lastActivityAt: 0, kind: "claude", taskId: nil),
                Instance(id: "b", cwd: "/x", status: "idle", lastActivityAt: 0, kind: "claude", taskId: nil),
            ]
        )
        initial.activeGroupId = "__other__"
        initial.layouts = ["__other__": tiledDefaultLayout(instanceIds: ["a", "b"], focusedInstanceId: "a")]
        let store = TestStore(initialState: initial) { InstancesFeature() } withDependencies: {
            $0.workspaceLayoutStore.save = { layouts in saveCalls.withValue { $0.append(layouts) } }
        }
        XCTAssertEqual(store.state.attentionIds, ["a"])
        await store.send(.instanceSelected("b")) {
            $0.selectedInstanceId = "b"
            $0.acked = ["b"]
            $0.layouts["__other__"] = focusPane(initial.layouts["__other__"]!, leafId: "d-b")
        }
        XCTAssertEqual(store.state.attentionIds, ["a"]) // "b" was never in attention; "a" untouched
        XCTAssertEqual(saveCalls.value.count, 1)
    }

    /// Group-tab tap: `groupActivated` must switch `activeGroupId` to the
    /// tapped group (not just default when nil), seed a fresh tiled layout
    /// for it since none exists yet, and mirror `selectedInstanceId` from
    /// that freshly-seeded layout's focus — same seed-or-restore semantics
    /// `seedActiveGroupIfNeeded` already applies to `instancesLoaded` /
    /// `layoutsLoaded`, just forced to a specific target group.
    func testGroupActivatedSwitchesActiveGroupAndSeeds() async {
        let saveCalls = LockIsolated<[WorkspaceState]>([])
        var initial = InstancesFeature.State(
            instances: [
                Instance(id: "a", cwd: "/x", status: "idle", lastActivityAt: 0, kind: "claude", taskId: nil),
                Instance(id: "b", cwd: "/y", status: "idle", lastActivityAt: 0, kind: "claude", taskId: nil),
            ],
            projects: [
                ProjectSummary(id: 1, name: "X", folderPath: "/x"),
                ProjectSummary(id: 2, name: "Y", folderPath: "/y"),
            ]
        )
        initial.activeGroupId = "1"
        initial.layouts = ["1": defaultTabLayout(instanceId: "a")]
        initial.selectedInstanceId = "a"
        let store = TestStore(initialState: initial) { InstancesFeature() } withDependencies: {
            $0.workspaceLayoutStore.save = { layouts in saveCalls.withValue { $0.append(layouts) } }
        }
        await store.send(.groupActivated(groupId: "2")) {
            $0.activeGroupId = "2"
            $0.layouts["2"] = defaultTabLayout(instanceId: "b")
            $0.selectedInstanceId = "b"
        }
        XCTAssertEqual(saveCalls.value.count, 1) // fresh seed for group "2" persists
    }

    func testAuthBlockFolds() async {
        let store = TestStore(initialState: InstancesFeature.State()) { InstancesFeature() }
        await store.send(.authBlockChanged(instanceId: "a", blocked: true)) { $0.blocked = ["a"] }
        await store.send(.authBlockChanged(instanceId: "a", blocked: false)) { $0.blocked = [] }
    }

    func testSpawnRequestedSeedsModalWithCurrentProjectsAndInstances() async {
        let projects = [ProjectSummary(id: 1, name: "X", folderPath: "/x")]
        let instances = [Instance(id: "a", cwd: "/x", status: "idle", lastActivityAt: 0, kind: "claude", taskId: nil)]
        let store = TestStore(
            initialState: InstancesFeature.State(instances: instances, projects: projects)
        ) { InstancesFeature() }
        await store.send(.spawnRequested) {
            $0.spawn = SpawnFeature.State(projects: projects, instances: instances)
        }
    }

    func testSpawnedInstanceAppendsRightSelectsAcksAndDismissesModal() async {
        let saveCalls = LockIsolated<[WorkspaceState]>([])
        var initial = InstancesFeature.State(
            instances: [Instance(id: "a", cwd: "/x", status: "idle", lastActivityAt: 0, kind: "claude", taskId: nil)]
        )
        initial.activeGroupId = "__other__"
        initial.layouts = ["__other__": defaultTabLayout(instanceId: "a")]
        initial.spawn = SpawnFeature.State()
        let store = TestStore(initialState: initial) { InstancesFeature() } withDependencies: {
            $0.workspaceLayoutStore.save = { layouts in saveCalls.withValue { $0.append(layouts) } }
        }
        // appendPaneRight mints a fresh random leaf id, so assert structurally
        // (mounted tab ids + focus-follows-the-new-leaf) rather than by exact
        // tree equality.
        store.exhaustivity = .off(showSkippedAssertions: false)
        await store.send(.spawn(.presented(.spawned("i9"))))
        XCTAssertEqual(store.state.acked, ["i9"])
        XCTAssertNil(store.state.spawn)
        XCTAssertEqual(store.state.selectedInstanceId, "i9")
        let layout = store.state.layouts["__other__"]!
        XCTAssertEqual(mountedInstanceIds(layout).sorted(), ["a", "i9"])
        XCTAssertEqual(layout.focusedLeafId, findLeafByTabId(layout.root, "i9")?.id)
        XCTAssertEqual(saveCalls.value.count, 1)
    }

    // MARK: - Pane actions (tiling)

    func testPaneSplitMutatesActiveLayoutFocusesNewLeafAndPersists() async {
        let saveCalls = LockIsolated<[WorkspaceState]>([])
        var initial = InstancesFeature.State(
            instances: [Instance(id: "a", cwd: "/x", status: "idle", lastActivityAt: 0, kind: "claude", taskId: nil)]
        )
        initial.activeGroupId = "__other__"
        initial.layouts = ["__other__": defaultTabLayout(instanceId: "a")]
        let store = TestStore(initialState: initial) { InstancesFeature() } withDependencies: {
            $0.workspaceLayoutStore.save = { layouts in saveCalls.withValue { $0.append(layouts) } }
        }
        // splitLeaf mints a fresh random node id too — assert structurally.
        store.exhaustivity = .off(showSkippedAssertions: false)
        await store.send(.paneSplit(leafId: "d-a", dir: .row, position: .after, instanceId: "b"))
        let layout = store.state.layouts["__other__"]!
        XCTAssertEqual(mountedInstanceIds(layout).sorted(), ["a", "b"])
        XCTAssertEqual(layout.focusedLeafId, findLeafByTabId(layout.root, "b")?.id)
        XCTAssertEqual(store.state.selectedInstanceId, "b")
        XCTAssertEqual(saveCalls.value.count, 1)
    }

    func testPaneSplitRefusesAnAlreadyMountedInstanceAsANoOp() async {
        let saveCalls = LockIsolated<[WorkspaceState]>([])
        var initial = InstancesFeature.State()
        initial.activeGroupId = "__other__"
        initial.layouts = ["__other__": defaultTabLayout(instanceId: "a")]
        let unchanged = initial.layouts["__other__"]!
        let store = TestStore(initialState: initial) { InstancesFeature() } withDependencies: {
            $0.workspaceLayoutStore.save = { layouts in saveCalls.withValue { $0.append(layouts) } }
        }
        await store.send(.paneSplit(leafId: "d-a", dir: .row, position: .after, instanceId: "a")) {
            // Refused (instance "a" already mounted) — layout is untouched;
            // only the selection mirror initializes from the unchanged focus.
            $0.selectedInstanceId = "a"
        }
        XCTAssertEqual(store.state.layouts["__other__"], unchanged)
        XCTAssertEqual(saveCalls.value.count, 1) // save is harmless even on a no-op mutation
    }

    func testPaneClosedCollapsesSplitBackToSurvivorWithFocusReassigned() async {
        let saveCalls = LockIsolated<[WorkspaceState]>([])
        var initial = InstancesFeature.State(
            instances: [
                Instance(id: "a", cwd: "/x", status: "idle", lastActivityAt: 0, kind: "claude", taskId: nil),
                Instance(id: "b", cwd: "/x", status: "idle", lastActivityAt: 0, kind: "claude", taskId: nil),
            ]
        )
        initial.activeGroupId = "__other__"
        initial.layouts = ["__other__": tiledDefaultLayout(instanceIds: ["a", "b"], focusedInstanceId: "b")]
        let store = TestStore(initialState: initial) { InstancesFeature() } withDependencies: {
            $0.workspaceLayoutStore.save = { layouts in saveCalls.withValue { $0.append(layouts) } }
        }
        await store.send(.paneClosed(leafId: "d-b")) {
            $0.layouts["__other__"] = defaultTabLayout(instanceId: "a")
            $0.selectedInstanceId = "a"
        }
        XCTAssertEqual(saveCalls.value.count, 1)
    }

    func testPaneFocusedUpdatesFocusMirrorsSelectionAndAcks() async {
        let saveCalls = LockIsolated<[WorkspaceState]>([])
        var initial = InstancesFeature.State(
            instances: [
                Instance(id: "a", cwd: "/x", status: "waiting-input", lastActivityAt: 0, kind: "claude", taskId: nil),
                Instance(id: "b", cwd: "/x", status: "idle", lastActivityAt: 0, kind: "claude", taskId: nil),
            ]
        )
        initial.activeGroupId = "__other__"
        initial.layouts = ["__other__": tiledDefaultLayout(instanceIds: ["a", "b"], focusedInstanceId: "b")]
        let store = TestStore(initialState: initial) { InstancesFeature() } withDependencies: {
            $0.workspaceLayoutStore.save = { layouts in saveCalls.withValue { $0.append(layouts) } }
        }
        XCTAssertEqual(store.state.attentionIds, ["a"])
        await store.send(.paneFocused(leafId: "d-a")) {
            $0.layouts["__other__"] = focusPane(initial.layouts["__other__"]!, leafId: "d-a")
            $0.selectedInstanceId = "a"
            $0.acked = ["a"]
        }
        XCTAssertEqual(store.state.attentionIds, [])
        XCTAssertEqual(saveCalls.value.count, 1)
    }

    func testPaneResizedUpdatesSplitSizesAndPersists() async {
        let saveCalls = LockIsolated<[WorkspaceState]>([])
        var initial = InstancesFeature.State()
        initial.activeGroupId = "__other__"
        initial.layouts = ["__other__": tiledDefaultLayout(instanceIds: ["a", "b"], focusedInstanceId: "a")]
        let store = TestStore(initialState: initial) { InstancesFeature() } withDependencies: {
            $0.workspaceLayoutStore.save = { layouts in saveCalls.withValue { $0.append(layouts) } }
        }
        let expected = resizeSplitSizes(initial.layouts["__other__"]!, splitId: "d-root", sizes: [70, 30])
        await store.send(.paneResized(splitId: "d-root", sizes: [70, 30])) {
            $0.layouts["__other__"] = expected
        }
        XCTAssertEqual(saveCalls.value.count, 1)
    }

    func testPaneReplacedSwapsInstanceInLeafAndMirrorsSelection() async {
        let saveCalls = LockIsolated<[WorkspaceState]>([])
        var initial = InstancesFeature.State()
        initial.activeGroupId = "__other__"
        initial.layouts = ["__other__": tiledDefaultLayout(instanceIds: ["a", "b"], focusedInstanceId: "b")]
        let store = TestStore(initialState: initial) { InstancesFeature() } withDependencies: {
            $0.workspaceLayoutStore.save = { layouts in saveCalls.withValue { $0.append(layouts) } }
        }
        let expected = replacePane(initial.layouts["__other__"]!, leafId: "d-b", instanceId: "c")
        await store.send(.paneReplaced(leafId: "d-b", instanceId: "c")) {
            $0.layouts["__other__"] = expected
            $0.selectedInstanceId = "c" // focusedLeafId ("d-b") unchanged; its tabId is now "c"
        }
        XCTAssertEqual(saveCalls.value.count, 1)
    }
}
