import XCTest
@testable import WatchtowerBridge

/// Port of tests/ipad/paneResize.test.ts + tests/ipad/paneNav.test.ts +
/// tests/ipad/panePicker.test.ts + tests/shared/computePaneRects.test.ts —
/// same vectors, ported to Swift XCTest.
final class PaneMathTests: XCTestCase {

    // MARK: - sizesAfterDrag (port of paneResize.test.ts)

    func test_sizesAfterDrag_movesPercentageRightward() {
        XCTAssertEqual(sizesAfterDrag([50, 50], dividerIndex: 0, deltaPercent: 10), [60, 40])
    }

    func test_sizesAfterDrag_movesTheOtherWayForNegativeDelta() {
        XCTAssertEqual(sizesAfterDrag([50, 50], dividerIndex: 0, deltaPercent: -20), [30, 70])
    }

    func test_sizesAfterDrag_clampsToMinimumAndDoesNotOvershoot() {
        XCTAssertEqual(sizesAfterDrag([50, 50], dividerIndex: 0, deltaPercent: 100, min: 8), [92, 8])
        XCTAssertEqual(sizesAfterDrag([50, 50], dividerIndex: 0, deltaPercent: -100, min: 8), [8, 92])
    }

    func test_sizesAfterDrag_onlyTouchesTheTwoPanesAroundTheDivider() {
        XCTAssertEqual(sizesAfterDrag([30, 40, 30], dividerIndex: 1, deltaPercent: 10), [30, 50, 20])
    }

    // MARK: - computePaneRects (port of computePaneRects.test.ts)

    func test_computePaneRects_singleLeafFillsTheWholeBox() {
        let rects = computePaneRects(.leaf(id: "a", tabId: "i1"), width: 1000, height: 800, gap: 6)
        XCTAssertEqual(rects["a"], PaneRect(x: 0, y: 0, w: 1000, h: 800))
    }

    func test_computePaneRects_rowSplitSubtractsOneGapAndHalvesTheRemainder() {
        let root = WorkspaceNode.split(
            id: "s", dir: .row, sizes: [50, 50],
            children: [.leaf(id: "a", tabId: "i1"), .leaf(id: "b", tabId: "i2")]
        )
        let rects = computePaneRects(root, width: 1006, height: 800, gap: 6)
        XCTAssertEqual(rects["a"], PaneRect(x: 0, y: 0, w: 500, h: 800))
        XCTAssertEqual(rects["b"], PaneRect(x: 506, y: 0, w: 500, h: 800))
    }

    func test_computePaneRects_colSplitStacksVerticallyWithAGap() {
        let root = WorkspaceNode.split(
            id: "s", dir: .col, sizes: [25, 75],
            children: [.leaf(id: "a", tabId: "i1"), .leaf(id: "b", tabId: "i2")]
        )
        let rects = computePaneRects(root, width: 400, height: 806, gap: 6)
        XCTAssertEqual(rects["a"], PaneRect(x: 0, y: 0, w: 400, h: 200))
        XCTAssertEqual(rects["b"], PaneRect(x: 0, y: 206, w: 400, h: 600))
    }

    func test_computePaneRects_nestedSplitTilesWithoutGapsOrOverlap() {
        let inner = WorkspaceNode.split(
            id: "s2", dir: .col, sizes: [50, 50],
            children: [.leaf(id: "b", tabId: "i2"), .leaf(id: "c", tabId: "i3")]
        )
        let root = WorkspaceNode.split(
            id: "s1", dir: .row, sizes: [50, 50],
            children: [.leaf(id: "a", tabId: "i1"), inner]
        )
        let rects = computePaneRects(root, width: 206, height: 206, gap: 6)
        XCTAssertEqual(rects["a"], PaneRect(x: 0, y: 0, w: 100, h: 206))
        XCTAssertEqual(rects["b"], PaneRect(x: 106, y: 0, w: 100, h: 100))
        XCTAssertEqual(rects["c"], PaneRect(x: 106, y: 106, w: 100, h: 100))
    }

    func test_computePaneRects_normalizesSizesThatDoNotSumTo100() {
        let root = WorkspaceNode.split(
            id: "s", dir: .row, sizes: [1, 3],
            children: [.leaf(id: "a", tabId: "i1"), .leaf(id: "b", tabId: "i2")]
        )
        let rects = computePaneRects(root, width: 400, height: 100, gap: 0)
        XCTAssertEqual(rects["a"]!.w, 100, accuracy: 0.0001)
        XCTAssertEqual(rects["b"]!.w, 300, accuracy: 0.0001)
    }

    func test_computePaneRects_emitsARectForSplitNodesTooForDividerPlacement() {
        let root = WorkspaceNode.split(
            id: "s", dir: .row, sizes: [50, 50],
            children: [.leaf(id: "a", tabId: "i1"), .leaf(id: "b", tabId: "i2")]
        )
        let rects = computePaneRects(root, width: 1006, height: 800, gap: 6)
        XCTAssertEqual(rects["s"], PaneRect(x: 0, y: 0, w: 1006, h: 800))
    }

    // MARK: - adjacentLeaf (port of paneNav.test.ts)

    private let navRects: [NodeId: PaneRect] = [
        "a": PaneRect(x: 0, y: 0, w: 100, h: 100),
        "b": PaneRect(x: 100, y: 0, w: 100, h: 100),
        "c": PaneRect(x: 0, y: 100, w: 100, h: 100),
    ]

    func test_adjacentLeaf_findsThePaneToTheRight() {
        XCTAssertEqual(adjacentLeaf(navRects, focusedLeafId: "a", dir: .right), "b")
    }

    func test_adjacentLeaf_findsThePaneBelow() {
        XCTAssertEqual(adjacentLeaf(navRects, focusedLeafId: "a", dir: .down), "c")
    }

    func test_adjacentLeaf_returnsNilWhenThereIsNoNeighbourThatWay() {
        XCTAssertNil(adjacentLeaf(navRects, focusedLeafId: "a", dir: .left))
        XCTAssertNil(adjacentLeaf(navRects, focusedLeafId: "b", dir: .right))
    }

    func test_adjacentLeaf_returnsNilForAnUnknownFocusedId() {
        XCTAssertNil(adjacentLeaf(navRects, focusedLeafId: "zzz", dir: .right))
    }

    // MARK: - availableInstancesForPicker (port of panePicker.test.ts)

    func test_availableInstancesForPicker_removesAlreadyMountedPreservingOrder() {
        XCTAssertEqual(
            availableInstancesForPicker(groupInstanceIds: ["a", "b", "c"], mountedInstanceIds: ["b"]),
            ["a", "c"]
        )
    }

    func test_availableInstancesForPicker_returnsEmptyWhenAllAreMounted() {
        XCTAssertEqual(
            availableInstancesForPicker(groupInstanceIds: ["a", "b"], mountedInstanceIds: ["a", "b"]),
            []
        )
    }

    func test_availableInstancesForPicker_isANoOpWhenNothingIsMounted() {
        XCTAssertEqual(
            availableInstancesForPicker(groupInstanceIds: ["a", "b"], mountedInstanceIds: []),
            ["a", "b"]
        )
    }
}
