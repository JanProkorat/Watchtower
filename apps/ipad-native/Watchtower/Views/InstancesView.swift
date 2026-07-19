import SwiftUI
import ComposableArchitecture
import WatchtowerCore
import WatchtowerBridge

/// Instances module: ONLY the centered project-grouped tab strip + the tiled
/// terminal workspace, plus the global authBlock banner — no nav chrome.
/// Matches the original apps/ipad `InstancesModule` (App.tsx ~78-285) exactly:
/// no title, no toolbar, no global Remove button. Removal is per-pane (see
/// `WorkspacePaneView`'s `onKill`), not a screen-level action. Port of
/// client/src/components/instances/*, TCA-shaped.
struct InstancesView: View {
    @Bindable var store: StoreOf<InstancesFeature>
    /// Reaches up to `IPadAppFeature.openRemoteForAuth` — the authBlock
    /// banner's only way to switch modules, since `InstancesFeature` doesn't
    /// know about its parent's `Module` enum.
    let onOpenRemote: () -> Void

    @Dependency(\.bridge) private var bridge

    var body: some View {
        VStack(spacing: 0) {
            if !store.blocked.isEmpty {
                authBanner
            }
            tabStrip
            detail
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .sheet(item: $store.scope(state: \.spawn, action: \.spawn)) { spawnStore in
            SpawnModalView(store: spawnStore)
        }
        .onAppear { store.send(.onAppear) }
    }

    /// Per-pane "kill" (terminate the Mac-side session): fire-and-forget
    /// `removeInstance` — the resulting `stateChanged` push refreshes the
    /// list — then drop the pane from the active tab's layout so it doesn't
    /// linger on a dead instance. Port of App.tsx's `WorkspacePane` `onKill`
    /// prop; wired here (not in the reducer) exactly like the old toolbar
    /// Remove button was, since `InstancesFeature` has no kill action.
    private func killInstance(leafId: NodeId, instanceId: String) {
        Task { _ = try? await bridge.invoke(RemoveInstanceRequest(instanceId: instanceId)) }
        store.send(.paneClosed(leafId: leafId))
    }

    private var authBanner: some View {
        let colors = Palette.status(.authBlock)
        return HStack {
            Text("Mac is waiting for a login")
                .font(.callout.weight(.medium))
                .foregroundStyle(colors.accent)
            Spacer()
            Button("Open Remote Mac", action: onOpenRemote)
                .buttonStyle(.borderedProminent)
                .tint(colors.accent)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .floatingGlass(cornerRadius: 14, tint: colors.fill)
        .padding(.horizontal, 16)
        .padding(.top, 10)
    }

    // Port of apps/ipad's TabStrip.tsx: a centered, pill-shaped, horizontally-
    // scrolling glass strip (height ~38pt) — centers when the tabs fit, scrolls
    // once they overflow. `.frame(maxWidth: .infinity, alignment: .center)`
    // inside the ScrollView achieves both without extra plumbing: the frame's
    // upper bound is never binding, so overflow still scrolls normally.
    private var tabStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            GlassEffectContainer(spacing: 6) {
                HStack(spacing: 6) {
                    ForEach(store.groups) { group in
                        groupTab(group)
                    }
                    newInstanceChip
                }
            }
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.horizontal, 16)
        }
        .frame(height: 38)
    }

    // Port of TabStrip.tsx's new-instance chip — small glass "+" pill right
    // after the tabs, opens the spawn/restart modal. Replaces the old
    // toolbar-level "New" button (dropped along with the rest of the nav
    // chrome).
    private var newInstanceChip: some View {
        Button {
            store.send(.spawnRequested)
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 13, weight: .semibold))
                .frame(height: 26)
                .padding(.horizontal, 10)
        }
        .buttonStyle(.plain)
        .foregroundStyle(Palette.textSecondary)
        .floatingGlass(cornerRadius: 10)
    }

    // Port of TabStrip.tsx's `GroupTab` — three-state status dot (amber glow
    // for attention, accentHover glow for the active tab, flat muted grey
    // otherwise) always rendered alongside the label, active tab in white on
    // a brighter glass fill.
    private func groupTab(_ group: ProjectGroup) -> some View {
        let selected = group.id == store.activeGroupId
        let needsAttention = group.instanceIds.contains { store.attentionIds.contains($0) }
        let dotColor: Color = needsAttention ? Palette.chartAmber : (selected ? Palette.accentHover : Color(white: 0.44))
        let glowing = needsAttention || selected
        return Button {
            store.send(.groupActivated(groupId: group.id))
        } label: {
            HStack(spacing: 6) {
                Circle()
                    .fill(dotColor)
                    .frame(width: 6, height: 6)
                    .shadow(color: glowing ? dotColor : .clear, radius: glowing ? 5 : 0)
                Text(group.label)
                    .font(.system(size: 13, weight: selected ? .semibold : .regular))
            }
            .padding(.horizontal, 12)
            .frame(height: 26)
            .foregroundStyle(selected ? .white : Palette.textSecondary)
            .floatingGlass(cornerRadius: 10, tint: selected ? Color.white.opacity(0.20) : nil)
        }
        .buttonStyle(.plain)
        .disabled(group.instanceIds.isEmpty)
    }

    @ViewBuilder private var detail: some View {
        // No active group / no persisted layout / an active group with no
        // live instances left must not force-unwrap into a dead tree — fall
        // back to the empty state instead.
        if let groupId = store.activeGroupId,
           let layout = store.layouts[groupId],
           let group = store.groups.first(where: { $0.id == groupId }),
           !group.instanceIds.isEmpty {
            WorkspacePaneView(
                node: layout.root,
                focusedLeafId: layout.focusedLeafId,
                groupInstanceIds: group.instanceIds,
                onSplit: { leafId, dir, position, instanceId in
                    store.send(.paneSplit(leafId: leafId, dir: dir, position: position, instanceId: instanceId))
                },
                onClose: { leafId in
                    store.send(.paneClosed(leafId: leafId))
                },
                onKill: { leafId, instanceId in
                    killInstance(leafId: leafId, instanceId: instanceId)
                },
                onResize: { splitId, sizes in
                    store.send(.paneResized(splitId: splitId, sizes: sizes))
                },
                onResizeCommitted: {
                    store.send(.paneResizeCommitted)
                },
                onFocus: { leafId in
                    store.send(.paneFocused(leafId: leafId))
                }
            )
        } else {
            VStack(spacing: 8) {
                Text("Select or spawn an instance")
                    .font(.title3)
                    .foregroundStyle(Palette.textMuted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}
