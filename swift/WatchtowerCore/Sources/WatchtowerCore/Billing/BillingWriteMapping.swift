import Foundation

// MARK: - Write-input value types
//
// Mirrors the *WriteInput interfaces in packages/data-supabase/src/billingWrites.ts.
// `taskId` / `projectId` are threaded through the builder functions separately
// rather than embedded here, since the same input shape is reused across
// insert (needs an id) and update (does not) call sites.

public struct WorklogWriteInput: Equatable, Sendable {
    public var workDate: String
    public var minutes: Double
    public var reportedMinutes: Double?
    public var description: String?

    public init(workDate: String, minutes: Double, reportedMinutes: Double?, description: String?) {
        self.workDate = workDate
        self.minutes = minutes
        self.reportedMinutes = reportedMinutes
        self.description = description
    }
}

public struct TaskWriteInput: Equatable, Sendable {
    public var epicId: Int
    public var number: String
    public var title: String
    public var status: String
    public var estimatedMinutes: Double?
    public var description: String?

    public init(epicId: Int, number: String, title: String, status: String, estimatedMinutes: Double?, description: String?) {
        self.epicId = epicId
        self.number = number
        self.title = title
        self.status = status
        self.estimatedMinutes = estimatedMinutes
        self.description = description
    }
}

public struct ContractWriteInput: Equatable, Sendable {
    public var effectiveFrom: String
    public var endDate: String?
    public var rateType: String
    public var rateAmount: Double
    public var hoursPerDay: Double
    public var mdLimit: Double?

    public init(effectiveFrom: String, endDate: String?, rateType: String, rateAmount: Double, hoursPerDay: Double, mdLimit: Double?) {
        self.effectiveFrom = effectiveFrom
        self.endDate = endDate
        self.rateType = rateType
        self.rateAmount = rateAmount
        self.hoursPerDay = hoursPerDay
        self.mdLimit = mdLimit
    }
}

// MARK: - Encodable payloads
//
// Every payload writes a custom `encode(to:)` rather than relying on
// synthesized Codable. The synthesized implementation calls
// `encodeIfPresent(_:forKey:)` for Optional stored properties, which OMITS
// the key entirely when the value is nil. The Supabase row shapes in
// billingWrites.ts always include those keys (explicit JSON `null`), so we
// route every optional column through the generic `encode(_:forKey:)`
// entry point instead, whose Optional-of-Encodable conformance emits an
// explicit `null`.

public struct WorklogInsertPayload: Encodable {
    public let syncId: String
    public let taskId: Int
    public let workDate: String
    public let minutes: Double
    public let reportedMinutes: Double?
    public let description: String?
    public let source: String
    public let externalId: String?
    public let jiraUploaded: Bool
    public let deletedAt: String?
    public let updatedAt: String
    public let effectiveMinutes: Double
    public let resolvedRate: Double?
    public let earnedAmount: Double?

    enum CodingKeys: String, CodingKey {
        case syncId = "sync_id"
        case taskId = "task_id"
        case workDate = "work_date"
        case minutes
        case reportedMinutes = "reported_minutes"
        case description
        case source
        case externalId = "external_id"
        case jiraUploaded = "jira_uploaded"
        case deletedAt = "deleted_at"
        case updatedAt = "updated_at"
        case effectiveMinutes = "effective_minutes"
        case resolvedRate = "resolved_rate"
        case earnedAmount = "earned_amount"
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(syncId, forKey: .syncId)
        try c.encode(taskId, forKey: .taskId)
        try c.encode(workDate, forKey: .workDate)
        try c.encode(minutes, forKey: .minutes)
        try c.encode(reportedMinutes, forKey: .reportedMinutes)
        try c.encode(description, forKey: .description)
        try c.encode(source, forKey: .source)
        try c.encode(externalId, forKey: .externalId)
        try c.encode(jiraUploaded, forKey: .jiraUploaded)
        try c.encode(deletedAt, forKey: .deletedAt)
        try c.encode(updatedAt, forKey: .updatedAt)
        try c.encode(effectiveMinutes, forKey: .effectiveMinutes)
        try c.encode(resolvedRate, forKey: .resolvedRate)
        try c.encode(earnedAmount, forKey: .earnedAmount)
    }
}

public struct WorklogUpdatePayload: Encodable {
    public let workDate: String
    public let minutes: Double
    public let reportedMinutes: Double?
    public let description: String?
    public let updatedAt: String
    public let effectiveMinutes: Double
    public let resolvedRate: Double?
    public let earnedAmount: Double?

    enum CodingKeys: String, CodingKey {
        case workDate = "work_date"
        case minutes
        case reportedMinutes = "reported_minutes"
        case description
        case updatedAt = "updated_at"
        case effectiveMinutes = "effective_minutes"
        case resolvedRate = "resolved_rate"
        case earnedAmount = "earned_amount"
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(workDate, forKey: .workDate)
        try c.encode(minutes, forKey: .minutes)
        try c.encode(reportedMinutes, forKey: .reportedMinutes)
        try c.encode(description, forKey: .description)
        try c.encode(updatedAt, forKey: .updatedAt)
        try c.encode(effectiveMinutes, forKey: .effectiveMinutes)
        try c.encode(resolvedRate, forKey: .resolvedRate)
        try c.encode(earnedAmount, forKey: .earnedAmount)
    }
}

public struct TaskInsertPayload: Encodable {
    public let syncId: String
    public let epicId: Int
    public let number: String
    public let title: String
    public let status: String
    public let estimatedMinutes: Double?
    public let description: String?
    public let deletedAt: String?
    public let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case syncId = "sync_id"
        case epicId = "epic_id"
        case number
        case title
        case status
        case estimatedMinutes = "estimated_minutes"
        case description
        case deletedAt = "deleted_at"
        case updatedAt = "updated_at"
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(syncId, forKey: .syncId)
        try c.encode(epicId, forKey: .epicId)
        try c.encode(number, forKey: .number)
        try c.encode(title, forKey: .title)
        try c.encode(status, forKey: .status)
        try c.encode(estimatedMinutes, forKey: .estimatedMinutes)
        try c.encode(description, forKey: .description)
        try c.encode(deletedAt, forKey: .deletedAt)
        try c.encode(updatedAt, forKey: .updatedAt)
    }
}

public struct TaskUpdatePayload: Encodable {
    public let epicId: Int
    public let number: String
    public let title: String
    public let status: String
    public let estimatedMinutes: Double?
    public let description: String?
    public let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case epicId = "epic_id"
        case number
        case title
        case status
        case estimatedMinutes = "estimated_minutes"
        case description
        case updatedAt = "updated_at"
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(epicId, forKey: .epicId)
        try c.encode(number, forKey: .number)
        try c.encode(title, forKey: .title)
        try c.encode(status, forKey: .status)
        try c.encode(estimatedMinutes, forKey: .estimatedMinutes)
        try c.encode(description, forKey: .description)
        try c.encode(updatedAt, forKey: .updatedAt)
    }
}

public struct ContractInsertPayload: Encodable {
    public let syncId: String
    public let projectId: Int
    public let effectiveFrom: String
    public let rateType: String
    public let rateAmount: Double
    public let hoursPerDay: Double
    public let endDate: String?
    public let mdLimit: Double?
    public let contractGroupId: String?
    public let deletedAt: String?
    public let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case syncId = "sync_id"
        case projectId = "project_id"
        case effectiveFrom = "effective_from"
        case rateType = "rate_type"
        case rateAmount = "rate_amount"
        case hoursPerDay = "hours_per_day"
        case endDate = "end_date"
        case mdLimit = "md_limit"
        case contractGroupId = "contract_group_id"
        case deletedAt = "deleted_at"
        case updatedAt = "updated_at"
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(syncId, forKey: .syncId)
        try c.encode(projectId, forKey: .projectId)
        try c.encode(effectiveFrom, forKey: .effectiveFrom)
        try c.encode(rateType, forKey: .rateType)
        try c.encode(rateAmount, forKey: .rateAmount)
        try c.encode(hoursPerDay, forKey: .hoursPerDay)
        try c.encode(endDate, forKey: .endDate)
        try c.encode(mdLimit, forKey: .mdLimit)
        try c.encode(contractGroupId, forKey: .contractGroupId)
        try c.encode(deletedAt, forKey: .deletedAt)
        try c.encode(updatedAt, forKey: .updatedAt)
    }
}

public struct ContractUpdatePayload: Encodable {
    public let effectiveFrom: String
    public let rateType: String
    public let rateAmount: Double
    public let hoursPerDay: Double
    public let endDate: String?
    public let mdLimit: Double?
    public let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case effectiveFrom = "effective_from"
        case rateType = "rate_type"
        case rateAmount = "rate_amount"
        case hoursPerDay = "hours_per_day"
        case endDate = "end_date"
        case mdLimit = "md_limit"
        case updatedAt = "updated_at"
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(effectiveFrom, forKey: .effectiveFrom)
        try c.encode(rateType, forKey: .rateType)
        try c.encode(rateAmount, forKey: .rateAmount)
        try c.encode(hoursPerDay, forKey: .hoursPerDay)
        try c.encode(endDate, forKey: .endDate)
        try c.encode(mdLimit, forKey: .mdLimit)
        try c.encode(updatedAt, forKey: .updatedAt)
    }
}

public struct ContractEndDatePayload: Encodable {
    public let endDate: String
    public let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case endDate = "end_date"
        case updatedAt = "updated_at"
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(endDate, forKey: .endDate)
        try c.encode(updatedAt, forKey: .updatedAt)
    }
}

public struct DayOffUpsertPayload: Encodable {
    public let syncId: String
    public let date: String
    public let kind: String
    public let note: String?
    public let deletedAt: String?
    public let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case syncId = "sync_id"
        case date
        case kind
        case note
        case deletedAt = "deleted_at"
        case updatedAt = "updated_at"
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(syncId, forKey: .syncId)
        try c.encode(date, forKey: .date)
        try c.encode(kind, forKey: .kind)
        try c.encode(note, forKey: .note)
        try c.encode(deletedAt, forKey: .deletedAt)
        try c.encode(updatedAt, forKey: .updatedAt)
    }
}

/// Shared soft-delete shape: every delete in the TS layer (`buildWorklogDelete`,
/// `buildTaskDelete`, `buildContractDelete`, `buildDayOffDelete`) is an UPDATE
/// stamping the same two columns — never a hard DELETE.
public struct SoftDeletePayload: Encodable {
    public let deletedAt: String
    public let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case deletedAt = "deleted_at"
        case updatedAt = "updated_at"
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(deletedAt, forKey: .deletedAt)
        try c.encode(updatedAt, forKey: .updatedAt)
    }
}

// MARK: - Builders

public func buildWorklogInsert(taskId: Int, input: WorklogWriteInput, syncId: String, now: String, billing: WorklogBilling) -> WorklogInsertPayload {
    WorklogInsertPayload(
        syncId: syncId,
        taskId: taskId,
        workDate: input.workDate,
        minutes: input.minutes,
        reportedMinutes: input.reportedMinutes,
        description: input.description,
        source: "manual",
        externalId: nil,
        jiraUploaded: false,
        deletedAt: nil,
        updatedAt: now,
        effectiveMinutes: billing.effectiveMinutes,
        resolvedRate: billing.resolvedRate,
        earnedAmount: billing.earnedAmount
    )
}

public func buildWorklogUpdate(input: WorklogWriteInput, now: String, billing: WorklogBilling) -> WorklogUpdatePayload {
    WorklogUpdatePayload(
        workDate: input.workDate,
        minutes: input.minutes,
        reportedMinutes: input.reportedMinutes,
        description: input.description,
        updatedAt: now,
        effectiveMinutes: billing.effectiveMinutes,
        resolvedRate: billing.resolvedRate,
        earnedAmount: billing.earnedAmount
    )
}

public func buildTaskInsert(input: TaskWriteInput, syncId: String, now: String) -> TaskInsertPayload {
    TaskInsertPayload(
        syncId: syncId,
        epicId: input.epicId,
        number: input.number,
        title: input.title,
        status: input.status,
        estimatedMinutes: input.estimatedMinutes,
        description: input.description,
        deletedAt: nil,
        updatedAt: now
    )
}

public func buildTaskUpdate(input: TaskWriteInput, now: String) -> TaskUpdatePayload {
    TaskUpdatePayload(
        epicId: input.epicId,
        number: input.number,
        title: input.title,
        status: input.status,
        estimatedMinutes: input.estimatedMinutes,
        description: input.description,
        updatedAt: now
    )
}

public func buildContractInsert(input: ContractWriteInput, projectId: Int, syncId: String, now: String, groupId: String? = nil) -> ContractInsertPayload {
    ContractInsertPayload(
        syncId: syncId,
        projectId: projectId,
        effectiveFrom: input.effectiveFrom,
        rateType: input.rateType,
        rateAmount: input.rateAmount,
        hoursPerDay: input.hoursPerDay,
        endDate: input.endDate,
        mdLimit: input.mdLimit,
        contractGroupId: groupId,
        deletedAt: nil,
        updatedAt: now
    )
}

public func buildContractUpdate(input: ContractWriteInput, now: String) -> ContractUpdatePayload {
    ContractUpdatePayload(
        effectiveFrom: input.effectiveFrom,
        rateType: input.rateType,
        rateAmount: input.rateAmount,
        hoursPerDay: input.hoursPerDay,
        endDate: input.endDate,
        mdLimit: input.mdLimit,
        updatedAt: now
    )
}

public func buildContractEndDate(endDate: String, now: String) -> ContractEndDatePayload {
    ContractEndDatePayload(endDate: endDate, updatedAt: now)
}

public func buildDayOffUpsert(date: String, kind: String, syncId: String, now: String) -> DayOffUpsertPayload {
    DayOffUpsertPayload(syncId: syncId, date: date, kind: kind, note: nil, deletedAt: nil, updatedAt: now)
}

public func softDelete(now: String) -> SoftDeletePayload {
    SoftDeletePayload(deletedAt: now, updatedAt: now)
}

// MARK: - Derived billing (writes + cache-only rebill)

/// Filters a project's contracts down to the shared `ContractLite` shape
/// consumed by `computeWorklogBilling`.
public func lite(_ contracts: [ContractRow], projectId: Int) -> [ContractLite] {
    contracts
        .filter { $0.projectId == projectId }
        .map { ContractLite(effectiveFrom: $0.effectiveFrom, rateType: $0.rateType, rateAmount: $0.rateAmount, hoursPerDay: $0.hoursPerDay) }
}

/// Derive billing fields for a write, using the same shared formula the Mac uses.
public func computeDerivedForWrite(contracts: [ContractRow], projectId: Int, minutes: Double, reportedMinutes: Double?, workDate: String) -> WorklogBilling {
    computeWorklogBilling(minutes: minutes, reportedMinutes: reportedMinutes, workDate: workDate, contracts: lite(contracts, projectId: projectId))
}

/// Recompute effectiveMinutes/earnedAmount for the given project's worklogs using
/// the provided contract set (cache-only display rebill). Other projects' worklogs
/// pass through unchanged. Mirrors the TS deriver in billingWrites.ts.
public func rebillProjectWorklogs(_ worklogs: [WorklogRow], projectId: Int, contracts: [ContractRow]) -> [WorklogRow] {
    worklogs.map { w in
        guard w.projectId == projectId else { return w }
        let billing = computeDerivedForWrite(contracts: contracts, projectId: projectId, minutes: w.minutes, reportedMinutes: w.reportedMinutes, workDate: w.workDate)
        return WorklogRow(
            syncId: w.syncId,
            workDate: w.workDate,
            minutes: w.minutes,
            reportedMinutes: w.reportedMinutes,
            effectiveMinutes: billing.effectiveMinutes,
            earnedAmount: billing.earnedAmount,
            description: w.description,
            projectId: w.projectId,
            projectName: w.projectName,
            projectColor: w.projectColor,
            projectKind: w.projectKind,
            isBillable: w.isBillable,
            taskNumber: w.taskNumber,
            taskTitle: w.taskTitle,
            source: w.source
        )
    }
}
