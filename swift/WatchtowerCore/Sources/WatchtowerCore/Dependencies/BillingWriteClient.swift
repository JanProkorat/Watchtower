import Foundation
import ComposableArchitecture
import Supabase

/// Decodes the `id` column returned by `.select("id").single()` after an
/// insert, so `insertTask` can hand the new DB id back to the caller.
private struct TaskIdRow: Decodable {
    let id: Int
}

/// Decodes the `sync_id` column for `findDayOffSyncId`'s existence probe.
private struct DayOffSyncIdRow: Decodable {
    let syncId: String

    enum CodingKeys: String, CodingKey {
        case syncId = "sync_id"
    }
}

/// Performs the Supabase writes behind the Records-editing UI (Milestone 3):
/// worklogs, tasks, contracts, and days-off inserts/updates/soft-deletes.
///
/// Every closure takes an already-built payload/id so the reducers stay pure
/// and testable — this client is the only place that touches PostgREST.
/// Mirrors `packages/data-supabase/src/billingWrites.ts`. Soft deletes are
/// UPDATEs (see `SoftDeletePayload` doc comment in BillingWriteMapping.swift),
/// never a hard DELETE — matching the TS layer.
@DependencyClient
public struct BillingWriteClient: Sendable {
    public var insertWorklog: @Sendable (_ payload: WorklogInsertPayload) async throws -> Void
    public var updateWorklog: @Sendable (_ syncId: String, _ payload: WorklogUpdatePayload) async throws -> Void
    public var softDeleteWorklog: @Sendable (_ syncId: String, _ payload: SoftDeletePayload) async throws -> Void

    public var insertTask: @Sendable (_ payload: TaskInsertPayload) async throws -> Int
    public var updateTask: @Sendable (_ syncId: String, _ payload: TaskUpdatePayload) async throws -> Void
    public var deleteTask: @Sendable (_ syncId: String, _ payload: SoftDeletePayload) async throws -> Void

    public var insertContracts: @Sendable (_ payloads: [ContractInsertPayload]) async throws -> Void
    public var updateContractEndDate: @Sendable (_ syncId: String, _ payload: ContractEndDatePayload) async throws -> Void
    public var updateContract: @Sendable (_ syncId: String, _ payload: ContractUpdatePayload) async throws -> Void
    public var deleteContract: @Sendable (_ syncId: String, _ payload: SoftDeletePayload) async throws -> Void
    public var deleteContractGroup: @Sendable (_ groupId: String, _ payload: SoftDeletePayload) async throws -> Void

    public var upsertDayOff: @Sendable (_ payload: DayOffUpsertPayload) async throws -> Void
    public var deleteDayOff: @Sendable (_ date: String, _ payload: SoftDeletePayload) async throws -> Void
    /// Looks up a day-off's `sync_id` INCLUDING soft-deleted rows (no
    /// `deleted_at` filter), so a re-toggled day can reuse the same sync id
    /// on upsert instead of minting a fresh tombstone/live pair.
    public var findDayOffSyncId: @Sendable (_ date: String) async throws -> String?
}

extension BillingWriteClient: DependencyKey {
    public static var liveValue: BillingWriteClient {
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

        return BillingWriteClient(
            insertWorklog: { payload in
                let db = try c()
                try await db.from("worklogs").insert(payload).execute()
            },
            updateWorklog: { syncId, payload in
                let db = try c()
                try await db.from("worklogs").update(payload).eq("sync_id", value: syncId).execute()
            },
            softDeleteWorklog: { syncId, payload in
                let db = try c()
                try await db.from("worklogs").update(payload).eq("sync_id", value: syncId).execute()
            },
            insertTask: { payload in
                let db = try c()
                let row: TaskIdRow = try await db.from("tasks")
                    .insert(payload)
                    .select("id")
                    .single()
                    .execute()
                    .value
                return row.id
            },
            updateTask: { syncId, payload in
                let db = try c()
                try await db.from("tasks").update(payload).eq("sync_id", value: syncId).execute()
            },
            deleteTask: { syncId, payload in
                let db = try c()
                try await db.from("tasks").update(payload).eq("sync_id", value: syncId).execute()
            },
            insertContracts: { payloads in
                let db = try c()
                try await db.from("contracts").insert(payloads).execute()
            },
            updateContractEndDate: { syncId, payload in
                let db = try c()
                try await db.from("contracts").update(payload).eq("sync_id", value: syncId).execute()
            },
            updateContract: { syncId, payload in
                let db = try c()
                try await db.from("contracts").update(payload).eq("sync_id", value: syncId).execute()
            },
            deleteContract: { syncId, payload in
                let db = try c()
                try await db.from("contracts").update(payload).eq("sync_id", value: syncId).execute()
            },
            deleteContractGroup: { groupId, payload in
                let db = try c()
                try await db.from("contracts").update(payload).eq("contract_group_id", value: groupId).execute()
            },
            upsertDayOff: { payload in
                let db = try c()
                try await db.from("days_off").upsert(payload, onConflict: "date").execute()
            },
            deleteDayOff: { date, payload in
                let db = try c()
                try await db.from("days_off").update(payload).eq("date", value: date).execute()
            },
            findDayOffSyncId: { date in
                let db = try c()
                let rows: [DayOffSyncIdRow] = try await db.from("days_off")
                    .select("sync_id")
                    .eq("date", value: date)
                    .limit(1)
                    .execute()
                    .value
                return rows.first?.syncId
            }
        )
    }

    public static let testValue = BillingWriteClient()
}

public extension DependencyValues {
    var billingWriteClient: BillingWriteClient {
        get { self[BillingWriteClient.self] }
        set { self[BillingWriteClient.self] = newValue }
    }
}
