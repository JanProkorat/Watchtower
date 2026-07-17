import Foundation

/// Pure workspace layout tree: model + ops.
/// Port of packages/shared/src/layout.ts (types) + workspaceTreeOps.ts (ops).
/// No TCA/UI dependency — value types and free functions only, so this is
/// host-unit-testable without a simulator.

public typealias NodeId = String

public enum SplitDir: String, Codable, Sendable {
    case row
    case col
}

public enum InsertPosition: Sendable {
    case before
    case after
}

/// A leaf hosts one tab (by opaque string id — TabId's tagged-union variants
/// collapse to plain String on the Swift side). A split holds 2+ children
/// with percent `sizes` that sum to ~100.
public indirect enum WorkspaceNode: Equatable, Sendable {
    case leaf(id: NodeId, tabId: String)
    case split(id: NodeId, dir: SplitDir, sizes: [Double], children: [WorkspaceNode])

    public var id: NodeId {
        switch self {
        case .leaf(let id, _): return id
        case .split(let id, _, _, _): return id
        }
    }
}

// MARK: - Constructors

public func makeLeaf(_ id: NodeId, _ tabId: String) -> WorkspaceNode {
    .leaf(id: id, tabId: tabId)
}

public func makeSplit(_ id: NodeId, _ dir: SplitDir, _ children: [WorkspaceNode], sizes: [Double]? = nil) -> WorkspaceNode {
    .split(id: id, dir: dir, sizes: sizes ?? evenSizes(children.count), children: children)
}

/// Evenly divide 100 into `n` shares, each rounded to 4 decimal places
/// (matching the TS `+(100 / n).toFixed(4)`); the LAST share absorbs the
/// rounding remainder so the array always sums to exactly 100.0.
public func evenSizes(_ n: Int) -> [Double] {
    guard n > 0 else { return [] }
    let share = roundTo4(100.0 / Double(n))
    var sizes = Array(repeating: share, count: n)
    sizes[sizes.count - 1] = roundTo4(100.0 - share * Double(n - 1))
    return sizes
}

private func roundTo4(_ value: Double) -> Double {
    (value * 10_000).rounded() / 10_000
}

/// Default id generator for freshly-created split/leaf nodes. Injectable via
/// `splitLeaf`'s `makeId` parameter so tests can supply a deterministic stub
/// (the TS source generates ids internally via `newNodeId()`; this mirrors
/// that behavior while keeping the Swift port test-friendly).
public func defaultNodeId() -> NodeId {
    "n" + UUID().uuidString
}

// MARK: - Queries

public func findLeafById(_ node: WorkspaceNode, _ id: NodeId) -> WorkspaceNode? {
    switch node {
    case .leaf(let leafId, _):
        return leafId == id ? node : nil
    case .split(_, _, _, let children):
        for child in children {
            if let hit = findLeafById(child, id) { return hit }
        }
        return nil
    }
}

/// First pre-order match by tabId (a tab may appear only once in a valid
/// tree, but callers may query mid-transition trees, so pick the first hit).
public func findLeafByTabId(_ node: WorkspaceNode, _ tabId: String) -> WorkspaceNode? {
    switch node {
    case .leaf(_, let leafTabId):
        return leafTabId == tabId ? node : nil
    case .split(_, _, _, let children):
        for child in children {
            if let hit = findLeafByTabId(child, tabId) { return hit }
        }
        return nil
    }
}

/// Leftmost leaf in pre-order. A split node is never constructed/left with
/// zero children (see `unmountLeaf`'s collapse rules), so recursing into the
/// first child always terminates at a leaf.
public func firstLeafInPreOrder(_ node: WorkspaceNode) -> WorkspaceNode {
    switch node {
    case .leaf:
        return node
    case .split(_, _, _, let children):
        guard let first = children.first else {
            preconditionFailure("split node with no children is not a valid WorkspaceTree state")
        }
        return firstLeafInPreOrder(first)
    }
}

public func collectTabIds(_ node: WorkspaceNode) -> [String] {
    switch node {
    case .leaf(_, let tabId):
        return [tabId]
    case .split(_, _, _, let children):
        return children.flatMap(collectTabIds)
    }
}

public func containsTabId(_ node: WorkspaceNode, _ tabId: String) -> Bool {
    switch node {
    case .leaf(_, let leafTabId):
        return leafTabId == tabId
    case .split(_, _, _, let children):
        return children.contains { containsTabId($0, tabId) }
    }
}

// MARK: - Mutations (pure — return a new tree)

/// Wrap `targetLeafId` in a new 2-child split, inserting a fresh leaf for
/// `newTabId` before/after it. GUARDED: mounting the same tab in two leaves
/// collides on the terminal-host slot registry (only one view can attach to
/// a given pty), leaving the second leaf blank — so if `newTabId` is already
/// mounted anywhere in the tree, this is a no-op and returns the SAME node
/// value (callers detect the refusal via `==`).
public func splitLeaf(
    _ node: WorkspaceNode,
    targetLeafId: NodeId,
    dir: SplitDir,
    position: InsertPosition,
    newTabId: String,
    makeId: () -> NodeId = defaultNodeId
) -> WorkspaceNode {
    if containsTabId(node, newTabId) { return node }
    return splitLeafInner(node, targetLeafId: targetLeafId, dir: dir, position: position, newTabId: newTabId, makeId: makeId)
}

private func splitLeafInner(
    _ node: WorkspaceNode,
    targetLeafId: NodeId,
    dir: SplitDir,
    position: InsertPosition,
    newTabId: String,
    makeId: () -> NodeId
) -> WorkspaceNode {
    switch node {
    case .leaf(let id, _):
        guard id == targetLeafId else { return node }
        let newLeaf = makeLeaf(makeId(), newTabId)
        let children = position == .before ? [newLeaf, node] : [node, newLeaf]
        return makeSplit(makeId(), dir, children)
    case .split(let id, let splitDir, let sizes, let children):
        return .split(
            id: id,
            dir: splitDir,
            sizes: sizes,
            children: children.map {
                splitLeafInner($0, targetLeafId: targetLeafId, dir: dir, position: position, newTabId: newTabId, makeId: makeId)
            }
        )
    }
}

/// Remove `leafId` from the tree. Collapse rules (ported exactly from TS):
/// - a split whose surviving children drop to 0 → returns `nil` (last pane closed)
/// - a split whose surviving children drop to 1 → returns that single child
///   DIRECTLY (the split node disappears; no 1-child split ever exists)
/// - a split with 2+ surviving children → kept, sizes rebalanced to `evenSizes(count)`
public func unmountLeaf(_ node: WorkspaceNode, leafId: NodeId) -> WorkspaceNode? {
    switch node {
    case .leaf(let id, _):
        return id == leafId ? nil : node
    case .split(let id, let dir, _, let children):
        let survivors = children.compactMap { unmountLeaf($0, leafId: leafId) }
        if survivors.isEmpty { return nil }
        if survivors.count == 1 { return survivors[0] }
        return .split(id: id, dir: dir, sizes: evenSizes(survivors.count), children: survivors)
    }
}

public func setSizes(_ node: WorkspaceNode, splitId: NodeId, sizes: [Double]) -> WorkspaceNode {
    switch node {
    case .leaf:
        return node
    case .split(let id, let dir, let curSizes, let children):
        if id == splitId {
            return .split(id: id, dir: dir, sizes: sizes, children: children)
        }
        return .split(
            id: id,
            dir: dir,
            sizes: curSizes,
            children: children.map { setSizes($0, splitId: splitId, sizes: sizes) }
        )
    }
}

public func replaceLeafTab(_ node: WorkspaceNode, leafId: NodeId, newTabId: String) -> WorkspaceNode {
    switch node {
    case .leaf(let id, _):
        return id == leafId ? .leaf(id: id, tabId: newTabId) : node
    case .split(let id, let dir, let sizes, let children):
        return .split(
            id: id,
            dir: dir,
            sizes: sizes,
            children: children.map { replaceLeafTab($0, leafId: leafId, newTabId: newTabId) }
        )
    }
}
