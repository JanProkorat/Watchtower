import Foundation
import ComposableArchitecture
import Supabase

@DependencyClient
public struct SupabaseClient: Sendable {
    public var currentSessionExists: @Sendable () async -> Bool = { false }
    public var signIn: @Sendable (_ email: String, _ password: String) async throws -> Void
    public var signOut: @Sendable () async -> Void
    public var authEvents: @Sendable () -> AsyncStream<Bool> = { .finished }
}

extension SupabaseClient: DependencyKey {
    public static var liveValue: SupabaseClient {
        // Built lazily on first use so unit tests importing the package don't
        // require Info.plist secrets (mirrors the JS getSupabase() lazy guard).
        let client = LockIsolated<Supabase.SupabaseClient?>(nil)
        @Sendable func c() throws -> Supabase.SupabaseClient {
            if let existing = client.value { return existing }
            let cfg = try SupabaseConfig.load(from: Bundle.main.infoDictionary ?? [:])
            let made = Supabase.SupabaseClient(supabaseURL: cfg.url, supabaseKey: cfg.anonKey)
            client.setValue(made)
            return made
        }
        return SupabaseClient(
            currentSessionExists: {
                guard let client = try? c() else { return false }
                return (try? await client.auth.session) != nil
            },
            signIn: { email, password in
                try await c().auth.signIn(email: email, password: password)
            },
            signOut: {
                try? await c().auth.signOut()
            },
            authEvents: {
                AsyncStream { continuation in
                    let task = Task {
                        guard let client = try? c() else { continuation.finish(); return }
                        for await (_, session) in client.auth.authStateChanges {
                            continuation.yield(session != nil)
                        }
                        continuation.finish()
                    }
                    continuation.onTermination = { _ in task.cancel() }
                }
            }
        )
    }

    public static let testValue = SupabaseClient()
}

public extension DependencyValues {
    var supabase: SupabaseClient {
        get { self[SupabaseClient.self] }
        set { self[SupabaseClient.self] = newValue }
    }
}
