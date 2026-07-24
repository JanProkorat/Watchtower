import Foundation

/// Tab-level layout: one WorkspaceNode tree per project-group tab, plus the
/// pure mutation ops used by the UI layer. Port of
/// apps/ipad/src/state/workspaceLayoutModel.ts — wraps Task 1's
/// WorkspaceTree primitives (WorkspaceTree.swift) with the instance-focused
/// semantics (default layouts, focus tracking, append-right).

public struct TabLayout: Codable, Equatable, Sendable {
    public var root: WorkspaceNode
    public var focusedLeafId: NodeId?

    public init(root: WorkspaceNode, focusedLeafId: NodeId?) {
        self.root = root
        self.focusedLeafId = focusedLeafId
    }
}

/// Keyed by project-group tab key (see App.tsx's tabKey() in the TS source).
public typealias WorkspaceState = [String: TabLayout]

/// Default layout for a tab with no saved layout: tile ALL the group's live
/// instances in a row (even widths), focusing `focusedInstanceId` if present
/// (else the first). This is why reconnecting/relaunching shows every
/// running instance instead of just one. Leaf ids are deterministic
/// (`d-<instanceId>`) so the layout is stable across renders.
public func tiledDefaultLayout(instanceIds: [String], focusedInstanceId: String) -> TabLayout {
    let ids = instanceIds.isEmpty ? [focusedInstanceId] : instanceIds
    if ids.count == 1 {
        let root = makeLeaf("d-\(ids[0])", ids[0])
        return TabLayout(root: root, focusedLeafId: root.id)
    }
    let children = ids.map { makeLeaf("d-\($0)", $0) }
    let root = makeSplit("d-root", .row, children) // even sizes
    let focused = children.first { leafTabId($0) == focusedInstanceId } ?? children[0]
    return TabLayout(root: root, focusedLeafId: focused.id)
}

/// Deterministic leaf id (not `defaultNodeId()`): an unstored tab's default
/// layout is rebuilt inline on every render, so a random id would change
/// each time, flip the view's `id(leafId)`, and remount the terminal —
/// defeating the "terminals never remount" invariant. New leaves from
/// splits still use `defaultNodeId()`; the `d-` vs `n` prefixes can't collide.
public func defaultTabLayout(instanceId: String) -> TabLayout {
    let root = makeLeaf("d-\(instanceId)", instanceId)
    return TabLayout(root: root, focusedLeafId: root.id)
}

public func splitPane(
    _ layout: TabLayout,
    targetLeafId: NodeId,
    dir: SplitDir,
    position: InsertPosition,
    instanceId: String
) -> TabLayout {
    let root = splitLeaf(layout.root, targetLeafId: targetLeafId, dir: dir, position: position, newTabId: instanceId)
    if root == layout.root { return layout } // refused (already mounted)
    let added = findLeafByTabId(root, instanceId)?.id
    return TabLayout(root: root, focusedLeafId: added ?? layout.focusedLeafId)
}

public func closePane(_ layout: TabLayout, leafId: NodeId, fallbackInstanceId: String) -> TabLayout {
    guard let root = unmountLeaf(layout.root, leafId: leafId) else {
        return defaultTabLayout(instanceId: fallbackInstanceId)
    }
    let focusStillValid = layout.focusedLeafId.flatMap { findLeafById(root, $0) } != nil
    let focusedLeafId = focusStillValid ? layout.focusedLeafId : firstLeafInPreOrder(root).id
    return TabLayout(root: root, focusedLeafId: focusedLeafId)
}

public func resizeSplitSizes(_ layout: TabLayout, splitId: NodeId, sizes: [Double]) -> TabLayout {
    TabLayout(root: setSizes(layout.root, splitId: splitId, sizes: sizes), focusedLeafId: layout.focusedLeafId)
}

public func replacePane(_ layout: TabLayout, leafId: NodeId, instanceId: String) -> TabLayout {
    TabLayout(root: replaceLeafTab(layout.root, leafId: leafId, newTabId: instanceId), focusedLeafId: layout.focusedLeafId)
}

/// Add `instanceId` as a new pane on the FAR RIGHT and even out the widths,
/// so a newly-spawned instance lands rightmost and every pane takes an equal
/// share. If the root is already a row split, append to it and re-even its
/// sizes; otherwise (a single leaf, or a column split) wrap the current root
/// in a new row split with the new pane on the right. Refuses (returns
/// unchanged) if the instance is already mounted.
public func appendPaneRight(_ layout: TabLayout, instanceId: String) -> TabLayout {
    if mountedInstanceIds(layout).contains(instanceId) { return layout }
    let newLeaf = makeLeaf(defaultNodeId(), instanceId)
    let root: WorkspaceNode
    if case .split(let id, .row, _, let children) = layout.root {
        root = makeSplit(id, .row, children + [newLeaf]) // re-evens sizes
    } else {
        root = makeSplit(defaultNodeId(), .row, [layout.root, newLeaf]) // wrap: 50/50
    }
    return TabLayout(root: root, focusedLeafId: newLeaf.id)
}

public func focusPane(_ layout: TabLayout, leafId: NodeId) -> TabLayout {
    TabLayout(root: layout.root, focusedLeafId: leafId)
}

public func mountedInstanceIds(_ layout: TabLayout) -> [String] {
    collectTabIds(layout.root)
}

/// Test/internal helper: pulls the tabId out of a leaf node (nil for a split).
private func leafTabId(_ node: WorkspaceNode) -> String? {
    if case .leaf(_, let tabId) = node { return tabId }
    return nil
}

// MARK: - WorkspaceNode Codable

/// `WorkspaceNode` is an `indirect enum` with differently-shaped associated
/// values per case, so Swift can't synthesize `Codable` — encode/decode
/// manually via a `kind` discriminator (`"leaf"` / `"split"`), matching the
/// TS side's discriminated-union JSON shape.
extension WorkspaceNode: Codable {
    private enum CodingKeys: String, CodingKey {
        case kind, id, tabId, dir, sizes, children
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(String.self, forKey: .kind)
        let id = try container.decode(NodeId.self, forKey: .id)
        switch kind {
        case "leaf":
            let tabId = try container.decode(String.self, forKey: .tabId)
            self = .leaf(id: id, tabId: tabId)
        case "split":
            let dir = try container.decode(SplitDir.self, forKey: .dir)
            let sizes = try container.decode([Double].self, forKey: .sizes)
            let children = try container.decode([WorkspaceNode].self, forKey: .children)
            self = .split(id: id, dir: dir, sizes: sizes, children: children)
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .kind,
                in: container,
                debugDescription: "Unknown WorkspaceNode kind: \(kind)"
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .leaf(let id, let tabId):
            try container.encode("leaf", forKey: .kind)
            try container.encode(id, forKey: .id)
            try container.encode(tabId, forKey: .tabId)
        case .split(let id, let dir, let sizes, let children):
            try container.encode("split", forKey: .kind)
            try container.encode(id, forKey: .id)
            try container.encode(dir, forKey: .dir)
            try container.encode(sizes, forKey: .sizes)
            try container.encode(children, forKey: .children)
        }
    }
}
