import Foundation
import ComposableArchitecture
import Supabase

/// Insert payload for a user reply against `attention_messages`. RLS only
/// permits inserts with `role = "user"`, so the constant is baked in here
/// rather than threaded through as a parameter — mirrors the
/// `BillingWriteMapping` snake_case `CodingKeys` idiom.
struct AttentionReplyInsert: Encodable, Sendable, Equatable {
    let syncId: String
    let instanceId: String
    let replyTo: String
    let body: String
    let createdAt: String
    let role = "user"

    enum CodingKeys: String, CodingKey {
        case syncId = "sync_id"
        case instanceId = "instance_id"
        case replyTo = "reply_to"
        case body
        case createdAt = "created_at"
        case role
    }
}

/// Lists attention threads and posts a user reply against the Supabase
/// `attention_messages` table. Network I/O only — no reducer wiring here
/// (see AttentionFeature, Tasks 10-11).
@DependencyClient
public struct AttentionClient: Sendable {
    public var listThreads: @Sendable () async throws -> [AttentionMessage]
    public var reply: @Sendable (
        _ instanceId: String,
        _ replyTo: String,
        _ body: String,
        _ syncId: String,
        _ createdAt: String
    ) async throws -> Void
}

extension AttentionClient: DependencyKey {
    public static var liveValue: AttentionClient {
        // Built lazily on first use, mirroring the BillingClient / SupabaseClient
        // lazy-client seam so unit tests importing the package don't require
        // Info.plist secrets.
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

        return AttentionClient(
            listThreads: {
                let db = try c()
                let dtos: [AttentionMessageDTO] = try await db.from("attention_messages")
                    .select("*")
                    .order("created_at")
                    .execute()
                    .value
                return dtos.map(mapAttentionRow)
            },
            reply: { instanceId, replyTo, body, syncId, createdAt in
                let db = try c()
                try await db.from("attention_messages")
                    .insert(AttentionReplyInsert(
                        syncId: syncId,
                        instanceId: instanceId,
                        replyTo: replyTo,
                        body: body,
                        createdAt: createdAt
                    ))
                    .execute()
            }
        )
    }

    public static let testValue = AttentionClient()
}

public extension DependencyValues {
    var attentionClient: AttentionClient {
        get { self[AttentionClient.self] }
        set { self[AttentionClient.self] = newValue }
    }
}
