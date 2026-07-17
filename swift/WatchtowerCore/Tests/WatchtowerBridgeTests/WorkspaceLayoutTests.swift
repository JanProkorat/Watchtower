import XCTest
@testable import WatchtowerBridge

/// Port of tests/ipad/workspaceLayoutModel.test.ts — same vectors, ported to
/// Swift XCTest, plus Codable round-trip + WorkspaceLayoutStore coverage
/// (persistence has no TS analogue; the TS side persists via
/// serializeWorkspace/deserializeWorkspace + a plain localStorage write).
final class WorkspaceLayoutTests: XCTestCase {

    // MARK: - Helpers (mirror the TS test file's local helpers)

    private func twoPane() -> TabLayout {
        let base = defaultTabLayout(instanceId: "i1")
        return splitPane(base, targetLeafId: rootLeafId(base), dir: .row, position: .after, instanceId: "i2")
    }

    private func rootLeafId(_ layout: TabLayout) -> NodeId {
        guard case .leaf(let id, _) = layout.root else {
            XCTFail("expected leaf root")
            return ""
        }
        return id
    }

    private func otherLeafId(_ layout: TabLayout, notThis: NodeId) -> NodeId {
        var ids: [NodeId] = []
        func walk(_ node: WorkspaceNode) {
            switch node {
            case .leaf(let id, _): ids.append(id)
            case .split(_, _, _, let children): children.forEach(walk)
            }
        }
        walk(layout.root)
        return ids.first { $0 != notThis } ?? notThis
    }

    // MARK: - defaultTabLayout

    func test_defaultTabLayout_isASingleFocusedLeafHoldingTheInstance() {
        let l = defaultTabLayout(instanceId: "i1")
        guard case .leaf = l.root else { return XCTFail("expected leaf") }
        XCTAssertEqual(mountedInstanceIds(l), ["i1"])
        XCTAssertEqual(l.focusedLeafId, rootLeafId(l))
    }

    func test_defaultTabLayout_usesDeterministicLeafId() {
        let l = defaultTabLayout(instanceId: "i1")
        XCTAssertEqual(l.root.id, "d-i1")
    }

    // MARK: - splitPane

    func test_splitPane_addsASecondPaneHoldingTheNewInstance() {
        let base = defaultTabLayout(instanceId: "i1")
        let l = splitPane(base, targetLeafId: rootLeafId(base), dir: .row, position: .after, instanceId: "i2")
        guard case .split = l.root else { return XCTFail("expected split") }
        XCTAssertEqual(mountedInstanceIds(l).sorted(), ["i1", "i2"])
    }

    func test_splitPane_refusesToMountAnInstanceAlreadyInTheTab() {
        let base = defaultTabLayout(instanceId: "i1")
        let l = splitPane(base, targetLeafId: rootLeafId(base), dir: .row, position: .after, instanceId: "i1")
        XCTAssertEqual(l.root, base.root) // unchanged
    }

    // MARK: - closePane

    func test_closePane_collapsesBackToTheSurvivingPane() {
        let base = defaultTabLayout(instanceId: "i1")
        let two = splitPane(base, targetLeafId: rootLeafId(base), dir: .row, position: .after, instanceId: "i2")
        guard case .split(_, _, _, let children) = two.root, case .leaf(let survivorId, _) = children[0] else {
            return XCTFail("expected split with leaf children")
        }
        let closed = closePane(two, leafId: otherLeafId(two, notThis: survivorId), fallbackInstanceId: "i1")
        guard case .leaf = closed.root else { return XCTFail("expected leaf") }
        XCTAssertEqual(mountedInstanceIds(closed), ["i1"])
    }

    func test_closingTheLastPane_fallsBackToADefaultSingleLeaf() {
        let base = defaultTabLayout(instanceId: "i1")
        let closed = closePane(base, leafId: rootLeafId(base), fallbackInstanceId: "i9")
        guard case .leaf = closed.root else { return XCTFail("expected leaf") }
        XCTAssertEqual(mountedInstanceIds(closed), ["i9"])
    }

    func test_closePane_movesFocusOffAClosedFocusedPane() {
        let base = defaultTabLayout(instanceId: "i1")
        let two = splitPane(base, targetLeafId: rootLeafId(base), dir: .row, position: .after, instanceId: "i2")
        guard case .split(_, _, _, let children) = two.root, case .leaf(let firstId, _) = children[0] else {
            return XCTFail("expected split with leaf children")
        }
        let focused = focusPane(two, leafId: firstId)
        let closed = closePane(focused, leafId: firstId, fallbackInstanceId: "i1")
        XCTAssertNotEqual(closed.focusedLeafId, firstId)
        XCTAssertNotNil(closed.focusedLeafId)
    }

    // MARK: - replacePane / resizeSplitSizes

    func test_replacePane_swapsTheInstanceInALeaf() {
        let base = defaultTabLayout(instanceId: "i1")
        let l = replacePane(base, leafId: rootLeafId(base), instanceId: "i5")
        XCTAssertEqual(mountedInstanceIds(l), ["i5"])
    }

    func test_resizeSplitSizes_updatesTheSplitSizes() {
        let base = defaultTabLayout(instanceId: "i1")
        let two = splitPane(base, targetLeafId: rootLeafId(base), dir: .row, position: .after, instanceId: "i2")
        let l = resizeSplitSizes(two, splitId: two.root.id, sizes: [70, 30])
        guard case .split(_, _, let sizes, _) = l.root else { return XCTFail("expected split") }
        XCTAssertEqual(sizes, [70, 30])
    }

    // MARK: - appendPaneRight

    func test_appendPaneRight_wrapsASingleLeafIntoAFiftyFiftyRowSplit_newPaneRightmostAndFocused() {
        let l = appendPaneRight(defaultTabLayout(instanceId: "i1"), instanceId: "i2")
        guard case .split(_, let dir, let sizes, let children) = l.root else { return XCTFail("expected split") }
        XCTAssertEqual(dir, .row)
        guard case .leaf(let lastId, let lastTabId) = children.last! else { return XCTFail("expected leaf") }
        XCTAssertEqual(lastTabId, "i2")
        XCTAssertEqual(l.focusedLeafId, lastId)
        XCTAssertEqual(sizes, [50, 50])
    }

    func test_appendPaneRight_appendsToAnExistingRowSplitAndEvensTheWidths_thirds() {
        let two = appendPaneRight(defaultTabLayout(instanceId: "i1"), instanceId: "i2")
        let three = appendPaneRight(two, instanceId: "i3")
        guard case .split(_, _, let sizes, let children) = three.root else { return XCTFail("expected split") }
        XCTAssertEqual(children.count, 3)
        XCTAssertEqual(mountedInstanceIds(three), ["i1", "i2", "i3"]) // order preserved, i3 rightmost
        sizes.forEach { XCTAssertEqual($0, 100.0 / 3, accuracy: 0.0001) }
    }

    func test_appendPaneRight_refusesAnAlreadyMountedInstance() {
        let two = appendPaneRight(defaultTabLayout(instanceId: "i1"), instanceId: "i2")
        XCTAssertEqual(appendPaneRight(two, instanceId: "i1"), two)
    }

    // MARK: - tiledDefaultLayout

    func test_tiledDefaultLayout_withOneInstance_isASingleFocusedLeaf() {
        let l = tiledDefaultLayout(instanceIds: ["i1"], focusedInstanceId: "i1")
        guard case .leaf = l.root else { return XCTFail("expected leaf") }
        XCTAssertEqual(mountedInstanceIds(l), ["i1"])
        XCTAssertEqual(l.focusedLeafId, l.root.id)
    }

    func test_tiledDefaultLayout_tilesAllLiveInstancesEvenRow_focusesTheGivenOne() {
        let l = tiledDefaultLayout(instanceIds: ["i1", "i2", "i3"], focusedInstanceId: "i2")
        guard case .split(_, let dir, let sizes, let children) = l.root else { return XCTFail("expected split") }
        XCTAssertEqual(dir, .row)
        XCTAssertEqual(mountedInstanceIds(l), ["i1", "i2", "i3"]) // order preserved
        sizes.forEach { XCTAssertEqual($0, 100.0 / 3, accuracy: 0.0001) }
        let focused = children.first { $0.id == l.focusedLeafId }
        guard case .leaf(_, let tabId)? = focused else { return XCTFail("expected focused leaf") }
        XCTAssertEqual(tabId, "i2")
    }

    func test_tiledDefaultLayout_fallsBackToTheFirstPaneWhenTheFocusIdIsAbsent() {
        let l = tiledDefaultLayout(instanceIds: ["i1", "i2"], focusedInstanceId: "nope")
        guard case .split(_, _, _, let children) = l.root else { return XCTFail("expected split") }
        XCTAssertEqual(l.focusedLeafId, children[0].id)
    }

    // MARK: - Codable round-trip

    func test_tabLayout_codableRoundTripsANestedTree() {
        let original = twoPane()
        let data = try! JSONEncoder().encode(original)
        let decoded = try! JSONDecoder().decode(TabLayout.self, from: data)
        XCTAssertEqual(decoded, original)
    }

    func test_workspaceState_codableRoundTripsWholeState() {
        let state: WorkspaceState = ["project:1": twoPane(), "other": defaultTabLayout(instanceId: "i9")]
        let data = try! JSONEncoder().encode(state)
        let decoded = try! JSONDecoder().decode(WorkspaceState.self, from: data)
        XCTAssertEqual(decoded, state)
    }

    // MARK: - WorkspaceLayoutStore

    private func ephemeralDefaults() -> UserDefaults {
        let suite = "workspace-layout-store-tests-\(UUID().uuidString)"
        let d = UserDefaults(suiteName: suite)!
        d.removePersistentDomain(forName: suite)
        return d
    }

    func test_store_loadReturnsEmptyDictWhenNothingSaved() {
        let store = WorkspaceLayoutStore.store(defaults: ephemeralDefaults())
        XCTAssertEqual(store.load(), [:])
    }

    func test_store_saveThenLoadRoundTrips() {
        let store = WorkspaceLayoutStore.store(defaults: ephemeralDefaults())
        let state: WorkspaceState = ["project:1": twoPane(), "other": defaultTabLayout(instanceId: "i9")]
        store.save(state)
        XCTAssertEqual(store.load(), state)
    }

    func test_store_loadToleratesCorruptData() {
        let defaults = ephemeralDefaults()
        defaults.set(Data("not json".utf8), forKey: WorkspaceLayoutStore.key)
        let store = WorkspaceLayoutStore.store(defaults: defaults)
        XCTAssertEqual(store.load(), [:])
    }
}
