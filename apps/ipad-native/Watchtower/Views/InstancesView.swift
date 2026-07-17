import SwiftUI
import ComposableArchitecture
import WatchtowerCore
import WatchtowerBridge

/// Instances module: a project-grouped horizontal tab strip (amber dot for
/// instances needing attention), the terminal pane for the selected
/// instance, a spawn/restart modal, native remove confirmation, and a global
/// authBlock banner. Port of client/src/components/instances/*, TCA-shaped.
struct InstancesView: View {
    @Bindable var store: StoreOf<InstancesFeature>
    /// Reaches up to `IPadAppFeature.openRemoteForAuth` — the authBlock
    /// banner's only way to switch modules, since `InstancesFeature` doesn't
    /// know about its parent's `Module` enum.
    let onOpenRemote: () -> Void

    @Dependency(\.bridge) private var bridge
    @State private var showRemoveConfirm = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if !store.blocked.isEmpty {
                    authBanner
                }
                tabStrip
                Divider().overlay(Color.white.opacity(0.08))
                detail
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .navigationTitle("Instances")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItemGroup(placement: .primaryAction) {
                    if store.selectedInstanceId != nil {
                        Button("Remove", role: .destructive) {
                            showRemoveConfirm = true
                        }
                        .buttonStyle(.glass)
                    }
                    Button {
                        store.send(.spawnRequested)
                    } label: {
                        Label("New", systemImage: "plus")
                    }
                    .buttonStyle(.glassProminent)
                    .tint(Palette.accent)
                }
            }
            .confirmationDialog(
                "Remove this instance?",
                isPresented: $showRemoveConfirm,
                titleVisibility: .visible
            ) {
                Button("Remove", role: .destructive) {
                    removeSelected()
                }
                Button("Cancel", role: .cancel) {}
            }
        }
        .sheet(item: $store.scope(state: \.spawn, action: \.spawn)) { spawnStore in
            SpawnModalView(store: spawnStore)
        }
        .onAppear { store.send(.onAppear) }
    }

    private func removeSelected() {
        guard let id = store.selectedInstanceId else { return }
        // Fire-and-forget: the resulting `stateChanged` push refreshes the list.
        Task { _ = try? await bridge.invoke(RemoveInstanceRequest(instanceId: id)) }
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

    private var tabStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            GlassEffectContainer(spacing: 8) {
                HStack(spacing: 8) {
                    ForEach(store.groups) { group in
                        groupTab(group)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
    }

    private func groupTab(_ group: ProjectGroup) -> some View {
        let selected = group.id == store.activeGroupId
        let needsAttention = group.instanceIds.contains { store.attentionIds.contains($0) }
        return Button {
            store.send(.groupActivated(groupId: group.id))
        } label: {
            HStack(spacing: 6) {
                if needsAttention {
                    Circle().fill(Palette.chartAmber).frame(width: 8, height: 8)
                }
                Text(group.label)
                    .font(.system(size: 14, weight: .medium))
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .foregroundStyle(selected ? Palette.accent : Palette.textMuted)
            .floatingGlass(cornerRadius: 12, tint: selected ? Palette.accentWash : nil)
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
                onResize: { splitId, sizes in
                    store.send(.paneResized(splitId: splitId, sizes: sizes))
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
