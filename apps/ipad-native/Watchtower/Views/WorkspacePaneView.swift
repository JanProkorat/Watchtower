import SwiftUI
import WatchtowerCore
import WatchtowerBridge

/// Gap (pt) reserved between sibling panes for the divider handle — mirrors
/// the TS reference's `GAP = 8` (apps/ipad/src/components/WorkspacePane.tsx).
private let paneGap: CGFloat = 8

/// Recursive tiling renderer for one project-group tab's `WorkspaceNode`
/// tree, plus the tab-wide keyboard shortcuts (⌘D / ⌘⇧D / ⌘W / ⌘⌥-arrows)
/// and the shared pane-picker overlay a split needs to pick its new pane's
/// instance. Port of apps/ipad/src/components/{WorkspacePane,PaneTerminal}.tsx
/// — SwiftUI's recursive `HStack`/`VStack` replaces the web version's flat
/// absolute-positioned pool (idiomatic here; the DOM-reparenting concern that
/// motivated the flat pool doesn't apply to SwiftUI's diffing the same way).
///
/// This is the single entry point `InstancesView` wires in: it owns the
/// `pendingSplit` state (shared by every leaf's split buttons AND the ⌘D/⌘⇧D
/// shortcuts, since a split needs one instance-picker regardless of which
/// leaf requested it) and the container `GeometryReader` used for ⌘⌥-arrow
/// navigation math (`computePaneRects` + `adjacentLeaf` over a leaf-only rect
/// map — split-node rects are filtered out so arrows never "focus" a split).
struct WorkspacePaneView: View {
    let node: WorkspaceNode
    let focusedLeafId: NodeId?
    /// All instances in this tab's project group, in group order — the pool
    /// `availableInstancesForPicker` filters down to "not yet mounted".
    let groupInstanceIds: [String]
    let onSplit: (NodeId, SplitDir, InsertPosition, String) -> Void
    let onClose: (NodeId) -> Void
    let onResize: (NodeId, [Double]) -> Void
    let onFocus: (NodeId) -> Void

    @State private var pendingSplit: PendingPaneSplit?

    private var mountedInstanceIds: [String] { collectTabIds(node) }

    var body: some View {
        GeometryReader { geo in
            ZStack {
                PaneNodeView(
                    node: node,
                    focusedLeafId: focusedLeafId,
                    onSplitRequested: { leafId, dir, position in
                        pendingSplit = PendingPaneSplit(leafId: leafId, dir: dir, position: position)
                    },
                    onClose: onClose,
                    onResize: onResize,
                    onFocus: onFocus
                )

                keyboardShortcutLayer(containerSize: geo.size)
            }
        }
        .sheet(item: $pendingSplit) { pending in
            PanePickerView(
                candidates: availableInstancesForPicker(
                    groupInstanceIds: groupInstanceIds,
                    mountedInstanceIds: mountedInstanceIds
                ),
                onPick: { instanceId in
                    onSplit(pending.leafId, pending.dir, pending.position, instanceId)
                    pendingSplit = nil
                },
                onCancel: { pendingSplit = nil }
            )
        }
    }

    /// Hidden buttons carrying the tab's keyboard shortcuts. Zero-sized and
    /// hit-test-transparent so they never intercept touches, but still live
    /// in the responder chain for `.keyboardShortcut` to fire on a hardware
    /// keyboard. All act on the CURRENT `focusedLeafId` — there is exactly
    /// one focused leaf per tab, so these never need a leaf id from the
    /// caller the way the chrome buttons do.
    @ViewBuilder
    private func keyboardShortcutLayer(containerSize: CGSize) -> some View {
        Group {
            Button("") { requestSplit(dir: .row) }
                .keyboardShortcut("d", modifiers: [.command])
            Button("") { requestSplit(dir: .col) }
                .keyboardShortcut("d", modifiers: [.command, .shift])
            Button("") { closeFocused() }
                .keyboardShortcut("w", modifiers: [.command])
            Button("") { moveFocus(.left, containerSize: containerSize) }
                .keyboardShortcut(.leftArrow, modifiers: [.command, .option])
            Button("") { moveFocus(.right, containerSize: containerSize) }
                .keyboardShortcut(.rightArrow, modifiers: [.command, .option])
            Button("") { moveFocus(.up, containerSize: containerSize) }
                .keyboardShortcut(.upArrow, modifiers: [.command, .option])
            Button("") { moveFocus(.down, containerSize: containerSize) }
                .keyboardShortcut(.downArrow, modifiers: [.command, .option])
        }
        .frame(width: 0, height: 0)
        .opacity(0)
        .accessibilityHidden(true)
    }

    private func requestSplit(dir: SplitDir) {
        guard let leafId = focusedLeafId else { return }
        pendingSplit = PendingPaneSplit(leafId: leafId, dir: dir, position: .after)
    }

    private func closeFocused() {
        guard let leafId = focusedLeafId else { return }
        onClose(leafId)
    }

    private func moveFocus(_ dir: NavDir, containerSize: CGSize) {
        guard let leafId = focusedLeafId, containerSize.width > 0, containerSize.height > 0 else { return }
        let rects = computePaneRects(node, width: Double(containerSize.width), height: Double(containerSize.height), gap: Double(paneGap))
        let leafOnly = Set(leafNodeIds(node))
        let leafRects = rects.filter { leafOnly.contains($0.key) }
        if let next = adjacentLeaf(leafRects, focusedLeafId: leafId, dir: dir) {
            onFocus(next)
        }
    }
}

/// A split request awaiting an instance pick — shared by every leaf's chrome
/// buttons and the ⌘D/⌘⇧D shortcuts (none of them know the instanceId yet;
/// that only comes from `PanePickerView`'s selection).
private struct PendingPaneSplit: Identifiable {
    let leafId: NodeId
    let dir: SplitDir
    let position: InsertPosition
    /// Only one split request can be pending at a time (the sheet is modal),
    /// so the leaf id alone is a stable, unique identity.
    var id: NodeId { leafId }
}

private func leafNodeIds(_ node: WorkspaceNode) -> [NodeId] {
    switch node {
    case .leaf(let id, _):
        return [id]
    case .split(_, _, _, let children):
        return children.flatMap(leafNodeIds)
    }
}

// MARK: - Recursive tree walk

/// Pure recursive renderer: `.leaf` → one terminal pane; `.split` → an
/// `HStack`/`VStack` of `PaneNodeView` children sized to their `sizes`
/// fraction. Kept private/split out from `WorkspacePaneView` so the tab-wide
/// concerns (keyboard shortcuts, the shared picker sheet) live exactly once,
/// at the top, instead of once per recursion level.
private struct PaneNodeView: View {
    let node: WorkspaceNode
    let focusedLeafId: NodeId?
    let onSplitRequested: (NodeId, SplitDir, InsertPosition) -> Void
    let onClose: (NodeId) -> Void
    let onResize: (NodeId, [Double]) -> Void
    let onFocus: (NodeId) -> Void

    var body: some View {
        switch node {
        case .leaf(let id, let tabId):
            PaneLeafView(
                leafId: id,
                tabId: tabId,
                focused: id == focusedLeafId,
                onSplitRequested: onSplitRequested,
                onClose: onClose,
                onFocus: onFocus
            )
        case .split(let id, let dir, let sizes, let children):
            PaneSplitView(
                splitId: id,
                dir: dir,
                sizes: sizes,
                children: children,
                focusedLeafId: focusedLeafId,
                onSplitRequested: onSplitRequested,
                onClose: onClose,
                onResize: onResize,
                onFocus: onFocus
            )
        }
    }
}

private struct PaneSplitView: View {
    let splitId: NodeId
    let dir: SplitDir
    let sizes: [Double]
    let children: [WorkspaceNode]
    let focusedLeafId: NodeId?
    let onSplitRequested: (NodeId, SplitDir, InsertPosition) -> Void
    let onClose: (NodeId) -> Void
    let onResize: (NodeId, [Double]) -> Void
    let onFocus: (NodeId) -> Void

    var body: some View {
        GeometryReader { geo in
            let total = Double(dir == .row ? geo.size.width : geo.size.height)
            let gapTotal = Double(paneGap) * Double(Swift.max(0, children.count - 1))
            let avail = Swift.max(0, total - gapTotal)
            let sum = sizes.reduce(0, +) == 0 ? 1 : sizes.reduce(0, +)
            Group {
                if dir == .row {
                    HStack(spacing: paneGap) { renderChildren(avail: avail, sum: sum) }
                } else {
                    VStack(spacing: paneGap) { renderChildren(avail: avail, sum: sum) }
                }
            }
        }
    }

    @ViewBuilder
    private func renderChildren(avail: Double, sum: Double) -> some View {
        ForEach(Array(children.enumerated()), id: \.element.id) { index, child in
            let fraction = index < sizes.count ? sizes[index] : 0
            let length = CGFloat((fraction / sum) * avail)
            PaneNodeView(
                node: child,
                focusedLeafId: focusedLeafId,
                onSplitRequested: onSplitRequested,
                onClose: onClose,
                onResize: onResize,
                onFocus: onFocus
            )
            .frame(width: dir == .row ? length : nil, height: dir == .col ? length : nil)
            .frame(maxWidth: dir == .col ? .infinity : nil, maxHeight: dir == .row ? .infinity : nil)

            // A divider's dividerIndex must stay within sizes.indices minus
            // its own +1 neighbour (sizesAfterDrag traps on an out-of-range
            // write) — guarding on sizes.count (not just children.count)
            // keeps this safe even if the two ever drift.
            if index < children.count - 1 && index < sizes.count - 1 {
                PaneDivider(dir: dir, splitId: splitId, index: index, sizes: sizes, avail: avail, onResize: onResize)
            }
        }
    }
}

/// Draggable handle between two sibling panes. Drag translation along the
/// split axis converts to a percent-of-`avail` delta, then `sizesAfterDrag`
/// clamps and redistributes it between the two flanking panes only. `sizes`
/// at drag-start is captured once (not re-read live) so the delta is always
/// relative to where the drag began, not to the just-applied resize.
private struct PaneDivider: View {
    let dir: SplitDir
    let splitId: NodeId
    let index: Int
    let sizes: [Double]
    let avail: Double
    let onResize: (NodeId, [Double]) -> Void

    @State private var dragStartSizes: [Double]?

    var body: some View {
        let sum = sizes.reduce(0, +) == 0 ? 1 : sizes.reduce(0, +)
        return Capsule()
            .fill(Palette.hairline)
            .frame(width: dir == .row ? 3 : 28, height: dir == .row ? 28 : 3)
            .frame(width: dir == .row ? paneGap : nil, height: dir == .col ? paneGap : nil)
            .frame(maxWidth: dir == .col ? .infinity : nil, maxHeight: dir == .row ? .infinity : nil)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        let base = dragStartSizes ?? sizes
                        if dragStartSizes == nil { dragStartSizes = sizes }
                        let delta = dir == .row ? value.translation.width : value.translation.height
                        let deltaPercent = avail > 0 ? Double(delta) / avail * sum : 0
                        onResize(splitId, sizesAfterDrag(base, dividerIndex: index, deltaPercent: deltaPercent))
                    }
                    .onEnded { _ in dragStartSizes = nil }
            )
    }
}

/// One terminal pane: `RemoteTerminalView` (never remounted — stable
/// `.id(tabId)`, and this leaf's own node id in the tree never changes across
/// resizes/focus changes) plus its chrome: split-right, split-down, close,
/// and a top-edge focus ring. Port of apps/ipad/src/components/PaneTerminal.tsx
/// (its "kill instance" affordance is intentionally not ported — Task 5's
/// reducer surface has no kill action; instance removal stays the toolbar's
/// Remove button, which already targets the focused leaf's instance).
private struct PaneLeafView: View {
    let leafId: NodeId
    let tabId: String
    let focused: Bool
    let onSplitRequested: (NodeId, SplitDir, InsertPosition) -> Void
    let onClose: (NodeId) -> Void
    let onFocus: (NodeId) -> Void

    var body: some View {
        ZStack(alignment: .topTrailing) {
            RemoteTerminalView(instanceId: tabId)
                .id(tabId)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(Palette.hairline, lineWidth: 1)
                )
                .overlay(alignment: .top) {
                    if focused {
                        RoundedRectangle(cornerRadius: 1.5)
                            .fill(Palette.accent)
                            .frame(height: 3)
                            .padding(.horizontal, 10)
                            .padding(.top, 2)
                            .allowsHitTesting(false)
                    }
                }
                .contentShape(Rectangle())
                .onTapGesture { onFocus(leafId) }

            chromeCluster
                .padding(6)
        }
    }

    private var chromeCluster: some View {
        GlassEffectContainer(spacing: 4) {
            HStack(spacing: 4) {
                chromeButton("arrow.right.to.line") { onSplitRequested(leafId, .row, .after) }
                chromeButton("arrow.down.to.line") { onSplitRequested(leafId, .col, .after) }
                chromeButton("xmark") { onClose(leafId) }
            }
        }
        .opacity(focused ? 1 : 0.55)
    }

    private func chromeButton(_ systemImage: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 11, weight: .semibold))
                .frame(width: 26, height: 26)
        }
        .buttonStyle(.glass)
        .tint(Palette.textMuted)
    }
}
