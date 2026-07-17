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
        public var selectedInstanceId: String? = nil

        public var groups: [ProjectGroup] { groupInstancesByProject(instances, projects: projects) }
        public var attentionIds: Set<String> { acknowledgedNeedingAttention(instances: instances, acked: acked) }

        public init(
            instances: [Instance] = [],
            projects: [ProjectSummary] = [],
            acked: Set<String> = [],
            blocked: Set<String> = [],
            selectedInstanceId: String? = nil
        ) {
            self.instances = instances
            self.projects = projects
            self.acked = acked
            self.blocked = blocked
            self.selectedInstanceId = selectedInstanceId
        }
    }

    public enum Action {
        case onAppear
        case refresh
        case instancesLoaded([Instance])
        case projectsLoaded([ProjectSummary])
        case stateChangedTick
        case instanceSelected(String)
        case authBlockChanged(instanceId: String, blocked: Bool)
    }

    private enum CancelID { case state, auth }

    @Dependency(\.bridge) var bridge

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
                var initialLoads: [Effect<Action>] = []
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
                return .none

            case let .projectsLoaded(projects):
                state.projects = projects
                return .none

            case .stateChangedTick:
                return Self.refreshEffect(bridge: bridge)

            case let .instanceSelected(id):
                state.selectedInstanceId = id
                state.acked.insert(id)
                return .none

            case let .authBlockChanged(instanceId, blocked):
                state.blocked = applyAuthBlock(state.blocked, instanceId: instanceId, blocked: blocked)
                return .none
            }
        }
    }
}
