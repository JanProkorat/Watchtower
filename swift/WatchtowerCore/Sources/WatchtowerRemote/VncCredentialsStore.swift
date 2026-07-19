import Foundation
import Security
import ComposableArchitecture

/// macOS Screen Sharing account short-username + login password (RFB type-30 auth),
/// distinct from Connection.token. Port of apps/ipad/src/state/vncCreds.ts, upgraded
/// from plaintext Preferences to the Keychain.
public struct VncCredentials: Codable, Equatable, Hashable, Sendable {
    public var username: String
    public var password: String
    public init(username: String, password: String) {
        self.username = username; self.password = password
    }
}

@DependencyClient
public struct VncCredentialsStore: Sendable {
    public var load: @Sendable () -> VncCredentials? = { nil }
    public var save: @Sendable (VncCredentials) -> Void
    public var clear: @Sendable () -> Void
}

extension VncCredentialsStore: DependencyKey {
    static let service = "watchtower.vnc.creds"

    public static let liveValue = VncCredentialsStore(
        load: {
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecReturnData as String: true,
                kSecMatchLimit as String: kSecMatchLimitOne,
            ]
            var out: CFTypeRef?
            guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess,
                  let data = out as? Data,
                  let creds = try? JSONDecoder().decode(VncCredentials.self, from: data)
            else { return nil }
            return creds
        },
        save: { creds in
            guard let data = try? JSONEncoder().encode(creds) else { return }
            let base: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
            ]
            SecItemDelete(base as CFDictionary) // idempotent overwrite
            var add = base
            add[kSecValueData as String] = data
            SecItemAdd(add as CFDictionary, nil)
        },
        clear: {
            let base: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
            ]
            SecItemDelete(base as CFDictionary)
        }
    )
}

public extension DependencyValues {
    var vncCredentialsStore: VncCredentialsStore {
        get { self[VncCredentialsStore.self] }
        set { self[VncCredentialsStore.self] = newValue }
    }
}
