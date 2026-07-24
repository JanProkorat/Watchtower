import XCTest
@testable import WatchtowerBridge

/// Port of tests/shared/workspaceTreeOps.test.ts — same vectors, same
/// tree shapes, ported to Swift XCTest.
final class WorkspaceTreeTests: XCTestCase {

    // MARK: - evenSizes

    func test_evenSizes_zero_isEmpty() {
        XCTAssertEqual(evenSizes(0), [])
    }

    func test_evenSizes_two_isFiftyFifty() {
        XCTAssertEqual(evenSizes(2), [50, 50])
    }

    func test_evenSizes_three_sumsToExactly100() {
        let sizes = evenSizes(3)
        XCTAssertEqual(sizes.count, 3)
        // First two get the truncated share; the last absorbs the remainder
        // so the sum is exactly 100 (matches TS: `100 - s * (n - 1)`).
        XCTAssertEqual(sizes[0], 33.3333, accuracy: 0.0001)
        XCTAssertEqual(sizes[1], 33.3333, accuracy: 0.0001)
        XCTAssertEqual(sizes.reduce(0, +), 100.0, accuracy: 1e-9)
    }

    // MARK: - findLeafById

    func test_findLeafById_findsNested() {
        let root = makeSplit("r", .row, [
            makeLeaf("a", "project:1"),
            makeSplit("s", .col, [makeLeaf("b", "project:2"), makeLeaf("c", "project:3")]),
        ])
        guard case let .leaf(_, tabId)? = findLeafById(root, "b") else {
            return XCTFail("expected leaf b")
        }
        XCTAssertEqual(tabId, "project:2")
        XCTAssertNil(findLeafById(root, "missing"))
    }

    // MARK: - findLeafByTabId

    func test_findLeafByTabId_returnsFirstMatchInPreOrder() {
        let root = makeSplit("r", .row, [makeLeaf("a", "project:1"), makeLeaf("b", "project:1")])
        XCTAssertEqual(findLeafByTabId(root, "project:1")?.id, "a")
    }

    // MARK: - firstLeafInPreOrder

    func test_firstLeafInPreOrder_returnsLeftmost() {
        let root = makeSplit("r", .row, [
            makeSplit("s", .col, [makeLeaf("a", "project:1"), makeLeaf("b", "project:2")]),
            makeLeaf("c", "project:3"),
        ])
        XCTAssertEqual(firstLeafInPreOrder(root).id, "a")
    }

    // MARK: - splitLeaf

    func test_splitLeaf_wrapsTargetLeafInASplit() {
        let root = makeLeaf("a", "project:1")
        let next = splitLeaf(root, targetLeafId: "a", dir: .row, position: .after, newTabId: "project:2")
        guard case let .split(_, dir, sizes, children) = next else {
            return XCTFail("expected split")
        }
        XCTAssertEqual(dir, .row)
        XCTAssertEqual(children.map { tabIdOrNil($0) }, ["project:1", "project:2"])
        XCTAssertEqual(sizes, [50, 50])
    }

    func test_splitLeaf_insertsBeforeTargetWhenPositionBefore() {
        let root = makeLeaf("a", "project:1")
        let next = splitLeaf(root, targetLeafId: "a", dir: .row, position: .before, newTabId: "project:9")
        guard case let .split(_, _, _, children) = next else {
            return XCTFail("expected split")
        }
        XCTAssertEqual(children.map { tabIdOrNil($0) }, ["project:9", "project:1"])
    }

    func test_splitLeaf_refusesToDuplicateAnAlreadyMountedTab() {
        // Mounting the same tab in two leaves collides on the slot registry
        // (only one DOM node can host a given terminal), leaving one pane
        // blank. splitLeaf must refuse and return the SAME tree (by value
        // equality — callers detect the no-op this way).
        let root = makeLeaf("a", "project:1")
        let next = splitLeaf(root, targetLeafId: "a", dir: .row, position: .after, newTabId: "project:1")
        XCTAssertEqual(next, root)
    }

    func test_splitLeaf_refusesToDuplicateWhenTabLivesInASiblingLeaf() {
        let root = makeSplit("r", .row, [makeLeaf("a", "project:1"), makeLeaf("b", "project:2")])
        let next = splitLeaf(root, targetLeafId: "b", dir: .col, position: .after, newTabId: "project:1")
        XCTAssertEqual(next, root)
    }

    // MARK: - replaceLeafTab

    func test_replaceLeafTab_swapsTabIdWithoutRestructuring() {
        let root = makeSplit("r", .row, [makeLeaf("a", "project:1"), makeLeaf("b", "project:2")])
        let next = replaceLeafTab(root, leafId: "a", newTabId: "project:9")
        XCTAssertEqual(findLeafById(next, "a").flatMap { tabIdOrNil($0) }, "project:9")
    }

    // MARK: - unmountLeaf

    func test_unmountLeaf_removesLeafAndFlattensSingleChildSplits() {
        let root = makeSplit("r", .row, [makeLeaf("a", "project:1"), makeLeaf("b", "project:2")])
        let next = unmountLeaf(root, leafId: "a")
        guard case let .leaf(id, _)? = next else {
            return XCTFail("expected leaf")
        }
        XCTAssertEqual(id, "b")
    }

    func test_unmountLeaf_returnsNilWhenRemovingTheOnlyLeaf() {
        let root = makeLeaf("a", "project:1")
        XCTAssertNil(unmountLeaf(root, leafId: "a"))
    }

    func test_unmountLeaf_prunesDeeplyNested() {
        let root = makeSplit("r", .row, [
            makeLeaf("a", "project:1"),
            makeSplit("s", .col, [makeLeaf("b", "project:2"), makeLeaf("c", "project:3")]),
        ])
        let next = unmountLeaf(root, leafId: "b")
        // s now has 1 surviving child → flattens to just 'c'; root becomes [a, c]
        guard case let .split(_, _, _, children)? = next else {
            return XCTFail("expected split")
        }
        XCTAssertEqual(children.map(\.id), ["a", "c"])
    }

    func test_unmountLeaf_rebalancesSizesWhenTwoOrMoreSurvivorsRemain() {
        let root = makeSplit("r", .row, [
            makeLeaf("a", "project:1"),
            makeLeaf("b", "project:2"),
            makeLeaf("c", "project:3"),
        ])
        let next = unmountLeaf(root, leafId: "a")
        guard case let .split(_, _, sizes, children)? = next else {
            return XCTFail("expected split")
        }
        XCTAssertEqual(children.map(\.id), ["b", "c"])
        XCTAssertEqual(sizes, [50, 50])
    }

    // MARK: - setSizes

    func test_setSizes_updatesSizesOnASplitById() {
        let root = makeSplit("r", .row, [makeLeaf("a", "project:1"), makeLeaf("b", "project:2")])
        let next = setSizes(root, splitId: "r", sizes: [30, 70])
        guard case let .split(_, _, sizes, _) = next else {
            return XCTFail("expected split")
        }
        XCTAssertEqual(sizes, [30, 70])
    }

    // MARK: - collectTabIds / containsTabId

    func test_collectTabIds_returnsAllReferencedTabs() {
        let root = makeSplit("r", .row, [
            makeLeaf("a", "project:1"),
            makeSplit("s", .col, [makeLeaf("b", "project:2"), makeLeaf("c", "project:1")]),
        ])
        XCTAssertEqual(Set(collectTabIds(root)), Set(["project:1", "project:2"]))
    }

    func test_containsTabId_trueForMountedFalseOtherwise() {
        let root = makeSplit("r", .row, [makeLeaf("a", "project:1"), makeLeaf("b", "project:2")])
        XCTAssertTrue(containsTabId(root, "project:1"))
        XCTAssertFalse(containsTabId(root, "project:9"))
    }
}

/// Test-only helper: pulls the tabId out of a leaf node (nil for a split).
private func tabIdOrNil(_ node: WorkspaceNode) -> String? {
    if case let .leaf(_, tabId) = node { return tabId }
    return nil
}
