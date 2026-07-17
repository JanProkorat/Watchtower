import Foundation
import ComposableArchitecture

/// Persists the saved Connection as JSON in UserDefaults under
/// "watchtower.connection" — the same key + JSON shape the Capacitor app used
/// in Capacitor Preferences. The apps don't share storage; keeping the shape
/// identical just makes manual debugging familiar.
@DependencyClient
public struct ConnectionStore: Sendable {
    public var load: @Sendable () -> Connection? = { nil }
    public var save: @Sendable (Connection) -> Void
}

extension ConnectionStore: DependencyKey {
    public static let key = "watchtower.connection"

    public static var liveValue: ConnectionStore {
        store(defaults: .standard)
    }

    public static func store(defaults: UserDefaults) -> ConnectionStore {
        ConnectionStore(
            load: {
                guard let data = defaults.data(forKey: key) else { return nil }
                return try? JSONDecoder().decode(Connection.self, from: data)
            },
            save: { conn in
                // Encoding a well-formed Connection cannot fail (plain Codable fields).
                if let data = try? JSONEncoder().encode(conn) {
                    defaults.set(data, forKey: key)
                }
            }
        )
    }
}

public extension DependencyValues {
    var connectionStore: ConnectionStore {
        get { self[ConnectionStore.self] }
        set { self[ConnectionStore.self] = newValue }
    }
}
