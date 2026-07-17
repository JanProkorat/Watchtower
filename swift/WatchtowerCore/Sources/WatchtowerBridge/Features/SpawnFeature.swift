import Foundation
import ComposableArchitecture

/// Spawn/restart modal logic: project picker (folderPath-bearing projects
/// only), instance-kind toggle, restartable list (non-live instances in the
/// chosen project's folder), and the spawnInstance/restartInstance calls.
/// The parent (Task 7) reacts to `.spawned` by selecting the instance and
/// dismissing the modal.
@Reducer
public struct SpawnFeature {
    @ObservableState
    public struct State: Equatable {
        public var projects: [ProjectSummary] = []
        public var instances: [Instance] = []
        public var selectedProjectId: Int? = nil
        public var instanceKind: String = "claude"
        public var errorMessage: String? = nil
        public var isSubmitting: Bool = false

        /// Only projects with a folder path can be spawned into.
        public var spawnableProjects: [ProjectSummary] { projects.filter { $0.folderPath != nil } }

        /// Non-live instances already running in the selected project's folder —
        /// candidates for "restart" rather than a fresh spawn.
        public var restartable: [Instance] {
            guard let selectedProjectId,
                  let path = projects.first(where: { $0.id == selectedProjectId })?.folderPath
            else { return [] }
            return instances.filter { $0.cwd == path && !InstanceAttention.live.contains($0.status) }
        }

        public init(
            projects: [ProjectSummary] = [],
            instances: [Instance] = [],
            selectedProjectId: Int? = nil,
            instanceKind: String = "claude",
            errorMessage: String? = nil,
            isSubmitting: Bool = false
        ) {
            self.projects = projects
            self.instances = instances
            self.selectedProjectId = selectedProjectId
            self.instanceKind = instanceKind
            self.errorMessage = errorMessage
            self.isSubmitting = isSubmitting
        }
    }

    public enum Action {
        case projectSelected(Int)
        case kindSelected(String)
        case spawnTapped
        case restartTapped(String)
        /// A spawn or restart succeeded; carries the (new or restarted) instance id.
        case spawned(String)
        case spawnFailed(String)
        case dismissed
    }

    @Dependency(\.bridge) var bridge

    public init() {}

    public var body: some ReducerOf<Self> {
        Reduce { state, action in
            switch action {
            case let .projectSelected(id):
                state.selectedProjectId = id
                state.errorMessage = nil
                return .none

            case let .kindSelected(kind):
                state.instanceKind = kind
                state.errorMessage = nil
                return .none

            case .spawnTapped:
                guard let selectedProjectId = state.selectedProjectId,
                      let folderPath = state.projects.first(where: { $0.id == selectedProjectId })?.folderPath
                else {
                    state.errorMessage = "Select a project"
                    return .none
                }
                state.isSubmitting = true
                state.errorMessage = nil
                let kind = state.instanceKind
                return .run { send in
                    do {
                        let response = try await bridge.invoke(SpawnInstanceRequest(cwd: folderPath, instanceKind: kind))
                        if let instanceId = response.instanceId {
                            await send(.spawned(instanceId))
                        } else {
                            await send(.spawnFailed(response.error ?? "Spawn failed"))
                        }
                    } catch {
                        await send(.spawnFailed("Spawn failed"))
                    }
                }

            case let .restartTapped(instanceId):
                state.isSubmitting = true
                state.errorMessage = nil
                return .run { send in
                    do {
                        let response = try await bridge.invoke(RestartInstanceRequest(instanceId: instanceId))
                        if response.ok {
                            await send(.spawned(instanceId))
                        } else {
                            await send(.spawnFailed("Restart failed"))
                        }
                    } catch {
                        await send(.spawnFailed("Restart failed"))
                    }
                }

            case .spawned:
                state.isSubmitting = false
                return .none

            case let .spawnFailed(message):
                state.errorMessage = message
                state.isSubmitting = false
                return .none

            case .dismissed:
                state.errorMessage = nil
                state.isSubmitting = false
                return .none
            }
        }
    }
}
