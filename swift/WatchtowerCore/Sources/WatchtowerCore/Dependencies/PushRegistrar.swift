import Dependencies
import DependenciesMacros
import Foundation
import Supabase

/// Upsert payload for the `push_devices` table (APNs token registration).
/// Mirrors the `BillingWriteMapping` snake_case `CodingKeys` idiom.
public struct PushDeviceUpsert: Encodable, Sendable, Equatable {
    public let apnsToken: String
    public let platform: String
    public let bundleId: String

    enum CodingKeys: String, CodingKey {
        case apnsToken = "apns_token"
        case platform
        case bundleId = "bundle_id"
    }

    public init(apnsToken: String, platform: String, bundleId: String) {
        self.apnsToken = apnsToken
        self.platform = platform
        self.bundleId = bundleId
    }
}

/// Registers the device's APNs token into Supabase's `push_devices` table so
/// the Mac hub can address push notifications to this device. Network I/O
/// only — no reducer wiring here (see AppDelegate, Task 7).
@DependencyClient
public struct PushRegistrar: Sendable {
    public var register: @Sendable (_ apnsToken: String) async throws -> Void
}

extension PushRegistrar: DependencyKey {
    public static var liveValue: PushRegistrar {
        // Built lazily on first use, mirroring the BillingWriteClient lazy
        // SupabaseClient seam so unit tests importing the package don't
        // require Info.plist secrets.
        let client = LockIsolated<Supabase.SupabaseClient?>(nil)
        @Sendable func c() throws -> Supabase.SupabaseClient {
            try client.withValue { current in
                if let existing = current { return existing }
                let cfg = try SupabaseConfig.load(from: Bundle.main.infoDictionary ?? [:])
                let made = Supabase.SupabaseClient(supabaseURL: cfg.url, supabaseKey: cfg.anonKey)
                current = made
                return made
            }
        }

        return PushRegistrar(
            register: { apnsToken in
                let db = try c()
                try await db.from("push_devices")
                    .upsert(
                        PushDeviceUpsert(
                            apnsToken: apnsToken,
                            platform: "ios",
                            bundleId: "cz.greencode.watchtower.ios"
                        ),
                        onConflict: "apns_token"
                    )
                    .execute()
            }
        )
    }

    public static let testValue = PushRegistrar()
}

public extension DependencyValues {
    var pushRegistrar: PushRegistrar {
        get { self[PushRegistrar.self] }
        set { self[PushRegistrar.self] = newValue }
    }
}
