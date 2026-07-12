import Foundation
import ComposableArchitecture
import Supabase

/// Repeatedly calls `page(from, to)` with an inclusive, zero-based row range,
/// starting at `from = 0` and advancing by `pageSize` each iteration, until a
/// page returns fewer than `pageSize` rows (signalling the last page).
/// Mirrors the JS `paginate.ts` `fetchAllPaged` helper.
public func fetchAllPaged<T>(
    pageSize: Int = 1000,
    _ page: (_ from: Int, _ to: Int) async throws -> [T]
) async rethrows -> [T] {
    var all: [T] = []
    var from = 0
    while true {
        let to = from + pageSize - 1
        let rows = try await page(from, to)
        all.append(contentsOf: rows)
        if rows.count < pageSize {
            break
        }
        from += pageSize
    }
    return all
}

@DependencyClient
public struct BillingClient: Sendable {
    public var fetchBillingDataset: @Sendable () async throws -> BillingDataset
}

extension BillingClient: DependencyKey {
    public static var liveValue: BillingClient {
        // Built lazily on first use, mirroring the Phase 1 `SupabaseClient`
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

        return BillingClient(
            fetchBillingDataset: {
                let db = try c()

                let worklogDTOs: [WorklogDTO] = try await fetchAllPaged { from, to in
                    try await db.from("worklogs")
                        .select("sync_id,work_date,minutes,effective_minutes,earned_amount,reported_minutes,description,source,tasks(number,title,epics(projects(id,name,color,kind,is_billable)))")
                        .is("deleted_at", value: nil)
                        .order("sync_id")
                        .range(from: from, to: to)
                        .execute()
                        .value
                }

                let taskDTOs: [TaskDTO] = try await fetchAllPaged { from, to in
                    try await db.from("tasks")
                        .select("id,sync_id,epic_id,number,title,status,estimated_minutes,jira_estimate_secs,jira_status,description,epics(projects(id,name,color,kind,is_billable))")
                        .is("deleted_at", value: nil)
                        .order("id")
                        .range(from: from, to: to)
                        .execute()
                        .value
                }

                let epicDTOs: [EpicDTO] = try await fetchAllPaged { from, to in
                    try await db.from("epics")
                        .select("id,name,project_id,status")
                        .is("deleted_at", value: nil)
                        .order("id")
                        .range(from: from, to: to)
                        .execute()
                        .value
                }

                let contractDTOs: [ContractDTO] = try await db.from("contracts")
                    .select("sync_id,project_id,effective_from,end_date,rate_type,rate_amount,hours_per_day,md_limit,contract_group_id")
                    .is("deleted_at", value: nil)
                    .execute()
                    .value

                let dayOffDTOs: [DayOffDTO] = try await db.from("days_off")
                    .select("date,kind,sync_id")
                    .is("deleted_at", value: nil)
                    .execute()
                    .value

                let projectDTOs: [ProjectDTO] = try await db.from("projects")
                    .select("id,name,color,kind,is_billable")
                    .is("deleted_at", value: nil)
                    .execute()
                    .value

                let fetchedAt = ISO8601DateFormatter().string(from: Date())

                return BillingDataset(
                    worklogs: worklogDTOs.map(BillingMapper.worklog),
                    contracts: contractDTOs.map(BillingMapper.contract),
                    daysOff: dayOffDTOs.map(BillingMapper.dayOff),
                    projects: projectDTOs.map(BillingMapper.project),
                    tasks: taskDTOs.map(BillingMapper.task),
                    epics: epicDTOs.map(BillingMapper.epic),
                    fetchedAt: fetchedAt
                )
            }
        )
    }

    public static let testValue = BillingClient()
}

public extension DependencyValues {
    var billingClient: BillingClient {
        get { self[BillingClient.self] }
        set { self[BillingClient.self] = newValue }
    }
}
