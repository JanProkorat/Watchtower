import Foundation

/// Pure pane-layout math: resize, rect computation, keyboard nav, and picker
/// set-difference. Port of packages/shared/src/computePaneRects.ts +
/// apps/ipad/src/lib/{paneResize,paneNav,panePicker}.ts.
/// No TCA/UI dependency — value types and free functions only, so this is
/// host-unit-testable without a simulator.

// MARK: - sizesAfterDrag (port of paneResize.ts)

/// Move `deltaPercent` from the pane right of a divider into the pane left of
/// it (positive delta grows the left pane). Only the two panes flanking the
/// divider change; both are clamped to `min`.
public func sizesAfterDrag(
    _ sizes: [Double],
    dividerIndex: Int,
    deltaPercent: Double,
    min: Double = 8
) -> [Double] {
    var next = sizes
    let a = dividerIndex < next.count ? next[dividerIndex] : 0
    let b = dividerIndex + 1 < next.count ? next[dividerIndex + 1] : 0
    let pair = a + b
    var newA = a + deltaPercent
    newA = Swift.max(min, Swift.min(pair - min, newA))
    next[dividerIndex] = newA
    next[dividerIndex + 1] = pair - newA
    return next
}

// MARK: - computePaneRects (port of computePaneRects.ts)

public struct PaneRect: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var w: Double
    public var h: Double

    public init(x: Double, y: Double, w: Double, h: Double) {
        self.x = x
        self.y = y
        self.w = w
        self.h = h
    }
}

/// Walk the workspace tree and assign EVERY node (leaves and splits) a pixel
/// rect that exactly tiles the [0,0,width,height] box. `gap` px is reserved
/// between sibling panes for divider handles (n children -> (n-1) gaps along
/// the split axis). Leaf rects position terminals; split rects (and their
/// children's rects) let the caller place resize-divider handles at split
/// boundaries.
public func computePaneRects(
    _ root: WorkspaceNode,
    width: Double,
    height: Double,
    gap: Double
) -> [NodeId: PaneRect] {
    var out: [NodeId: PaneRect] = [:]
    walkPaneRects(root, x: 0, y: 0, w: width, h: height, gap: gap, out: &out)
    return out
}

private func walkPaneRects(
    _ node: WorkspaceNode,
    x: Double, y: Double, w: Double, h: Double,
    gap: Double,
    out: inout [NodeId: PaneRect]
) {
    out[node.id] = PaneRect(x: x, y: y, w: w, h: h)
    guard case .split(_, let dir, let sizes, let children) = node else {
        return
    }
    let n = children.count
    let totalGap = gap * Double(Swift.max(0, n - 1))
    let sum = sizes.reduce(0, +) == 0 ? 1 : sizes.reduce(0, +)
    if dir == .row {
        let avail = w - totalGap
        var cx = x
        for (i, child) in children.enumerated() {
            let size = i < sizes.count ? sizes[i] : 0
            let cw = (size / sum) * avail
            walkPaneRects(child, x: cx, y: y, w: cw, h: h, gap: gap, out: &out)
            cx += cw + gap
        }
    } else {
        let avail = h - totalGap
        var cy = y
        for (i, child) in children.enumerated() {
            let size = i < sizes.count ? sizes[i] : 0
            let ch = (size / sum) * avail
            walkPaneRects(child, x: x, y: cy, w: w, h: ch, gap: gap, out: &out)
            cy += ch + gap
        }
    }
}

// MARK: - adjacentLeaf (port of paneNav.ts)

public enum NavDir: Sendable {
    case left, right, up, down
}

/// Nearest leaf whose center lies in `dir` from the focused pane's center,
/// tie-broken by cross-axis proximity (prefer aligned neighbours). Returns
/// nil when the focused id is unknown or there is no pane that way. Caller
/// passes a leaf-only rect map.
public func adjacentLeaf(
    _ rects: [NodeId: PaneRect],
    focusedLeafId: NodeId,
    dir: NavDir
) -> NodeId? {
    guard let from = rects[focusedLeafId] else { return nil }
    let fc = (x: from.x + from.w / 2, y: from.y + from.h / 2)
    var best: NodeId?
    var bestScore = Double.infinity
    for (id, r) in rects {
        if id == focusedLeafId { continue }
        let c = (x: r.x + r.w / 2, y: r.y + r.h / 2)
        let inDir: Bool
        switch dir {
        case .right: inDir = c.x > fc.x
        case .left: inDir = c.x < fc.x
        case .down: inDir = c.y > fc.y
        case .up: inDir = c.y < fc.y
        }
        if !inDir { continue }
        let primary = (dir == .left || dir == .right) ? abs(c.x - fc.x) : abs(c.y - fc.y)
        let cross = (dir == .left || dir == .right) ? abs(c.y - fc.y) : abs(c.x - fc.x)
        let score = primary + cross * 2 // prefer aligned neighbours
        if score < bestScore {
            bestScore = score
            best = id
        }
    }
    return best
}

// MARK: - availableInstancesForPicker (port of panePicker.ts)

/// Instances offered when filling a new pane: the tab group's instances
/// minus those already mounted in the current layout, preserving group order.
public func availableInstancesForPicker(
    groupInstanceIds: [String],
    mountedInstanceIds: [String]
) -> [String] {
    let mounted = Set(mountedInstanceIds)
    return groupInstanceIds.filter { !mounted.contains($0) }
}
