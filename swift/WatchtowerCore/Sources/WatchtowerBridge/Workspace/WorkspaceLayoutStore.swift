import Foundation
import ComposableArchitecture

/// Persists the WorkspaceState (per-tab pane layouts) as JSON in
/// UserDefaults under "watchtower.ipad.workspace.tiling.v1". Mirrors
/// ConnectionStore's shape: a `.store(defaults:)` seam for tests, a
/// `liveValue` backed by `.standard`, corrupt/missing data resolves to the
/// empty state rather than throwing.
@DependencyClient
public struct WorkspaceLayoutStore: Sendable {
    public var load: @Sendable () -> WorkspaceState = { [:] }
    public var save: @Sendable (WorkspaceState) -> Void
}

extension WorkspaceLayoutStore: DependencyKey {
    public static let key = "watchtower.ipad.workspace.tiling.v1"

    public static var liveValue: WorkspaceLayoutStore {
        store(defaults: .standard)
    }

    public static func store(defaults: UserDefaults) -> WorkspaceLayoutStore {
        WorkspaceLayoutStore(
            load: {
                guard let data = defaults.data(forKey: key) else { return [:] }
                return (try? JSONDecoder().decode(WorkspaceState.self, from: data)) ?? [:]
            },
            save: { state in
                // Encoding a well-formed WorkspaceState cannot fail (plain Codable fields).
                if let data = try? JSONEncoder().encode(state) {
                    defaults.set(data, forKey: key)
                }
            }
        )
    }
}

public extension DependencyValues {
    var workspaceLayoutStore: WorkspaceLayoutStore {
        get { self[WorkspaceLayoutStore.self] }
        set { self[WorkspaceLayoutStore.self] = newValue }
    }
}
