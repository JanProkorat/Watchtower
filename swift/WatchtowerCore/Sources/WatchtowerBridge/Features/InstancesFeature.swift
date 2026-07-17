import Foundation
import ComposableArchitecture

/// Instances module: the live list of managed Claude Code / shell sessions,
/// grouped by project, with the attention-dot ack overlay and the authBlock set.
/// Port of client/src/state/useInstances.ts + useAuthBlock.ts, TCA-shaped.
@Reducer
public struct InstancesFeature {
    @ObservableState
    public struct State: Equatable {
        public var instances: [Instance] = []
        public var projects: [ProjectSummary] = []
        /// Instance ids the user has already seen/dismissed at their current attention status.
        public var acked: Set<String> = []
        /// Instance ids currently blocked on a Claude auth prompt.
        public var blocked: Set<String> = []
        /// Stored mirror of the active group's `TabLayout.focusedLeafId` (its
        /// leaf's tabId) — kept in sync by `mirrorFocus` after every layout
        /// mutation, so toolbar/authBlock consumers can keep reading this one
        /// field without reaching into `layouts[activeGroupId]` themselves.
        public var selectedInstanceId: String? = nil
        /// Per-project-group-tab pane tree, keyed by `ProjectGroup.id`.
        /// Persisted via `workspaceLayoutStore` on every mutation.
        public var layouts: WorkspaceState = [:]
        /// The currently-shown project-group tab (same keying as `layouts`).
        /// Defaults to the first group once instances/projects are known.
        public var activeGroupId: String? = nil
        @Presents public var spawn: SpawnFeature.State?

        public var groups: [ProjectGroup] { groupInstancesByProject(instances, projects: projects) }
        public var attentionIds: Set<String> { acknowledgedNeedingAttention(instances: instances, acked: acked) }

        public init(
            instances: [Instance] = [],
            projects: [ProjectSummary] = [],
            acked: Set<String> = [],
            blocked: Set<String> = [],
            selectedInstanceId: String? = nil,
            layouts: WorkspaceState = [:],
            activeGroupId: String? = nil
        ) {
            self.instances = instances
            self.projects = projects
            self.acked = acked
            self.blocked = blocked
            self.selectedInstanceId = selectedInstanceId
            self.layouts = layouts
            self.activeGroupId = activeGroupId
        }
    }

    public enum Action {
        case onAppear
        case refresh
        case instancesLoaded([Instance])
        case projectsLoaded([ProjectSummary])
        case stateChangedTick
        /// Group-tab tap: switch the active project-group tab. Seeds a fresh
        /// tiled layout if this group has never had one, or restores its
        /// persisted layout (mirroring `selectedInstanceId` either way) —
        /// same semantics as `seedActiveGroupIfNeeded`'s first-shown seeding,
        /// but forcing the target group instead of only defaulting when nil.
        case groupActivated(groupId: String)
        case instanceSelected(String)
        case authBlockChanged(instanceId: String, blocked: Bool)
        /// The "+ New" toolbar action — seeds and presents the spawn/restart modal.
        case spawnRequested
        case spawn(PresentationAction<SpawnFeature.Action>)
        /// The persisted per-tab pane layouts, loaded once on the first `onAppear`.
        case layoutsLoaded(WorkspaceState)
        case paneSplit(leafId: NodeId, dir: SplitDir, position: InsertPosition, instanceId: String)
        case paneClosed(leafId: NodeId)
        case paneResized(splitId: NodeId, sizes: [Double])
        case paneFocused(leafId: NodeId)
        case paneReplaced(leafId: NodeId, instanceId: String)
    }

    private enum CancelID { case state, auth }

    @Dependency(\.bridge) var bridge
    @Dependency(\.workspaceLayoutStore) var workspaceLayoutStore

    public init() {}

    /// Shared by `.refresh` and the initial `.onAppear` fetch — kept as a plain
    /// effect (not routed through `.send(.refresh)`) so onAppear's first load
    /// surfaces a single `.instancesLoaded`, not an intermediate `.refresh` action.
    private static func refreshEffect(bridge: BridgeClient) -> Effect<Action> {
        .run { send in
            let instances = (try? await bridge.invoke(ListInstancesRequest()))?.instances ?? []
            await send(.instancesLoaded(instances.map {
                Instance(id: $0.id, cwd: $0.cwd, status: $0.status, lastActivityAt: $0.lastActivityAt, kind: $0.kind, taskId: $0.taskId)
            }))
        }
    }

    /// Recomputes `selectedInstanceId` from the active group's
    /// `focusedLeafId` → leaf tabId, keeping the stored mirror in sync after
    /// any layout mutation. Returns the mirrored tabId (nil if the group,
    /// layout, or leaf can't be resolved — e.g. no active group yet).
    @discardableResult
    private static func mirrorFocus(_ state: inout State, groupId: String) -> String? {
        guard let layout = state.layouts[groupId],
              let focusedLeafId = layout.focusedLeafId,
              case .leaf(_, let tabId)? = findLeafById(layout.root, focusedLeafId)
        else { return nil }
        state.selectedInstanceId = tabId
        return tabId
    }

    /// First-shown seeding (port of App.tsx's `ensureTab`): default the active
    /// tab to the first group (or, when `forcedGroupId` is supplied — the
    /// `groupActivated` group-tab-tap path — switch to that group instead of
    /// only defaulting when nil). If the target group already has a layout —
    /// either restored from `workspaceLayoutStore` or seeded by an earlier
    /// call — just mirror `selectedInstanceId` from it (this is the
    /// persisted-restore path: relaunching with saved split panes, or
    /// switching back to a previously-visited tab, must land on the
    /// previously focused instance, not `nil`, without waiting for a manual
    /// pane tap). Otherwise tile all the group's live instances via
    /// `tiledDefaultLayout` and persist. Idempotent: safe to call from
    /// `instancesLoaded`, `layoutsLoaded`, and `groupActivated` regardless of
    /// call order.
    private static func seedActiveGroupIfNeeded(
        _ state: inout State,
        workspaceLayoutStore: WorkspaceLayoutStore,
        forcedGroupId: String? = nil
    ) {
        let groups = state.groups
        guard !groups.isEmpty else { return }
        if let forcedGroupId {
            state.activeGroupId = forcedGroupId
        } else if state.activeGroupId == nil {
            state.activeGroupId = groups[0].id
        }
        guard let groupId = state.activeGroupId else { return }
        if state.layouts[groupId] != nil {
            mirrorFocus(&state, groupId: groupId)
            return
        }
        guard let group = groups.first(where: { $0.id == groupId }),
              let seed = group.instanceIds.first
        else { return }
        state.layouts[groupId] = tiledDefaultLayout(instanceIds: group.instanceIds, focusedInstanceId: seed)
        mirrorFocus(&state, groupId: groupId)
        workspaceLayoutStore.save(state.layouts)
    }

    public var body: some ReducerOf<Self> {
        Reduce { state, action in
            switch action {
            case .onAppear:
                // Resubscribing (e.g. returning to this tab) must not re-fetch data
                // that's already loaded — only the initial appearance does that;
                // subsequent appearances just re-arm the live push subscriptions.
                let subscriptions: Effect<Action> = .merge(
                    .run { send in
                        for await raw in await bridge.pushes(BridgePush.stateChanged) {
                            guard (try? JSONDecoder().decode(StateChangedPush.self, from: raw)) != nil else { continue }
                            await send(.stateChangedTick)
                        }
                    }
                    .cancellable(id: CancelID.state, cancelInFlight: true),
                    .run { send in
                        for await raw in await bridge.pushes(BridgePush.authBlock) {
                            guard let push = try? JSONDecoder().decode(AuthBlockPush.self, from: raw) else { continue }
                            await send(.authBlockChanged(instanceId: push.instanceId, blocked: push.blocked))
                        }
                    }
                    .cancellable(id: CancelID.auth, cancelInFlight: true)
                )
                // Ordered (not merged) so the first appearance's projectsLoaded
                // reliably lands before instancesLoaded — grouping reads both.
                // layoutsLoaded goes first so any persisted layout is in place
                // before instancesLoaded's group-seeding check runs.
                var initialLoads: [Effect<Action>] = []
                if state.layouts.isEmpty {
                    initialLoads.append(.send(.layoutsLoaded(workspaceLayoutStore.load())))
                }
                if state.projects.isEmpty {
                    initialLoads.append(.run { send in
                        let projects = (try? await bridge.invoke(ProjectsListRequest()))?.projects ?? []
                        await send(.projectsLoaded(projects.map {
                            ProjectSummary(id: $0.id, name: $0.name, folderPath: $0.folderPath)
                        }))
                    })
                }
                if state.instances.isEmpty {
                    initialLoads.append(Self.refreshEffect(bridge: bridge))
                }
                return .merge(subscriptions, .concatenate(initialLoads))

            case .refresh:
                return Self.refreshEffect(bridge: bridge)

            case let .instancesLoaded(instances):
                state.instances = instances
                state.acked = reconcileAcked(state.acked, instances: instances)
                Self.seedActiveGroupIfNeeded(&state, workspaceLayoutStore: workspaceLayoutStore)
                return .none

            case let .projectsLoaded(projects):
                state.projects = projects
                return .none

            case .stateChangedTick:
                return Self.refreshEffect(bridge: bridge)

            case let .groupActivated(groupId):
            Self.seedActiveGroupIfNeeded(&state, workspaceLayoutStore: workspaceLayoutStore, forcedGroupId: groupId)
            return .none

        case let .instanceSelected(id):
                // Selecting from the tab strip also focuses that instance's
                // pane in the active group's layout (if it's mounted there).
                state.acked.insert(id)
                if let groupId = state.activeGroupId,
                   let layout = state.layouts[groupId],
                   let leaf = findLeafByTabId(layout.root, id) {
                    state.layouts[groupId] = focusPane(layout, leafId: leaf.id)
                    workspaceLayoutStore.save(state.layouts)
                }
                state.selectedInstanceId = id
                return .none

            case let .authBlockChanged(instanceId, blocked):
                state.blocked = applyAuthBlock(state.blocked, instanceId: instanceId, blocked: blocked)
                return .none

            case .spawnRequested:
                state.spawn = SpawnFeature.State(projects: state.projects, instances: state.instances)
                return .none

            case let .spawn(.presented(.spawned(id))):
                state.acked.insert(id)
                state.spawn = nil
                // Tile the freshly-spawned instance into the active group's
                // layout, far right (matches iPad App.tsx's appendRight).
                guard let groupId = state.activeGroupId else {
                    state.selectedInstanceId = id
                    return .none
                }
                let current = state.layouts[groupId] ?? defaultTabLayout(instanceId: id)
                state.layouts[groupId] = appendPaneRight(current, instanceId: id)
                Self.mirrorFocus(&state, groupId: groupId)
                workspaceLayoutStore.save(state.layouts)
                return .none

            case .spawn:
                return .none

            case let .layoutsLoaded(loaded):
                state.layouts = loaded
                Self.seedActiveGroupIfNeeded(&state, workspaceLayoutStore: workspaceLayoutStore)
                return .none

            case let .paneSplit(leafId, dir, position, instanceId):
                guard let groupId = state.activeGroupId else { return .none }
                let current = state.layouts[groupId] ?? defaultTabLayout(instanceId: instanceId)
                state.layouts[groupId] = splitPane(current, targetLeafId: leafId, dir: dir, position: position, instanceId: instanceId)
                Self.mirrorFocus(&state, groupId: groupId)
                workspaceLayoutStore.save(state.layouts)
                return .none

            case let .paneClosed(leafId):
                guard let groupId = state.activeGroupId else { return .none }
                let fallback = state.selectedInstanceId
                    ?? state.groups.first(where: { $0.id == groupId })?.instanceIds.first
                    ?? ""
                let current = state.layouts[groupId] ?? defaultTabLayout(instanceId: fallback)
                state.layouts[groupId] = closePane(current, leafId: leafId, fallbackInstanceId: fallback)
                Self.mirrorFocus(&state, groupId: groupId)
                workspaceLayoutStore.save(state.layouts)
                return .none

            case let .paneResized(splitId, sizes):
                guard let groupId = state.activeGroupId, let current = state.layouts[groupId] else { return .none }
                state.layouts[groupId] = resizeSplitSizes(current, splitId: splitId, sizes: sizes)
                workspaceLayoutStore.save(state.layouts)
                return .none

            case let .paneFocused(leafId):
                guard let groupId = state.activeGroupId, let current = state.layouts[groupId] else { return .none }
                state.layouts[groupId] = focusPane(current, leafId: leafId)
                if let id = Self.mirrorFocus(&state, groupId: groupId) {
                    state.acked.insert(id)
                }
                workspaceLayoutStore.save(state.layouts)
                return .none

            case let .paneReplaced(leafId, instanceId):
                guard let groupId = state.activeGroupId, let current = state.layouts[groupId] else { return .none }
                state.layouts[groupId] = replacePane(current, leafId: leafId, instanceId: instanceId)
                Self.mirrorFocus(&state, groupId: groupId)
                workspaceLayoutStore.save(state.layouts)
                return .none
            }
        }
        .ifLet(\.$spawn, action: \.spawn) {
            SpawnFeature()
        }
    }
}
