import Foundation

public struct WorklogRow: Equatable, Codable, Sendable {
    public let syncId: String
    public let workDate: String
    public let minutes: Double
    public let reportedMinutes: Double?
    public let effectiveMinutes: Double
    public let earnedAmount: Double?
    public let description: String?
    public let projectId: Int
    public let projectName: String
    public let projectColor: String?
    public let projectKind: String
    public let isBillable: Bool
    public let taskNumber: String?
    public let taskTitle: String?
    public let source: String?

    public init(syncId: String, workDate: String, minutes: Double, reportedMinutes: Double?,
                effectiveMinutes: Double, earnedAmount: Double?, description: String?,
                projectId: Int, projectName: String, projectColor: String?,
                projectKind: String, isBillable: Bool, taskNumber: String?,
                taskTitle: String?, source: String?) {
        self.syncId = syncId
        self.workDate = workDate
        self.minutes = minutes
        self.reportedMinutes = reportedMinutes
        self.effectiveMinutes = effectiveMinutes
        self.earnedAmount = earnedAmount
        self.description = description
        self.projectId = projectId
        self.projectName = projectName
        self.projectColor = projectColor
        self.projectKind = projectKind
        self.isBillable = isBillable
        self.taskNumber = taskNumber
        self.taskTitle = taskTitle
        self.source = source
    }
}

public struct TaskRow: Equatable, Codable, Sendable {
    public let taskId: Int
    public let syncId: String
    public let epicId: Int
    public let taskNumber: String?
    public let taskTitle: String
    public let status: String
    public let estimatedMinutes: Int?
    public let description: String?
    public let projectId: Int
    public let projectName: String
    public let projectColor: String?
    public let projectKind: String
    public let isBillable: Bool
    public let jiraStatus: String?

    public init(taskId: Int, syncId: String, epicId: Int, taskNumber: String?,
                taskTitle: String, status: String, estimatedMinutes: Int?,
                description: String?, projectId: Int, projectName: String,
                projectColor: String?, projectKind: String, isBillable: Bool,
                jiraStatus: String?) {
        self.taskId = taskId
        self.syncId = syncId
        self.epicId = epicId
        self.taskNumber = taskNumber
        self.taskTitle = taskTitle
        self.status = status
        self.estimatedMinutes = estimatedMinutes
        self.description = description
        self.projectId = projectId
        self.projectName = projectName
        self.projectColor = projectColor
        self.projectKind = projectKind
        self.isBillable = isBillable
        self.jiraStatus = jiraStatus
    }
}

public struct EpicRow: Equatable, Codable, Sendable {
    public let epicId: Int
    public let name: String
    public let projectId: Int
    public let status: String

    public init(epicId: Int, name: String, projectId: Int, status: String) {
        self.epicId = epicId
        self.name = name
        self.projectId = projectId
        self.status = status
    }
}

public struct ContractRow: Equatable, Codable, Sendable {
    public let syncId: String
    public let projectId: Int
    public let effectiveFrom: String
    public let endDate: String?
    public let rateType: String
    public let rateAmount: Double
    public let hoursPerDay: Double
    public let mdLimit: Double?
    public let contractGroupId: String?

    public init(syncId: String, projectId: Int, effectiveFrom: String,
                endDate: String?, rateType: String, rateAmount: Double,
                hoursPerDay: Double, mdLimit: Double?, contractGroupId: String?) {
        self.syncId = syncId
        self.projectId = projectId
        self.effectiveFrom = effectiveFrom
        self.endDate = endDate
        self.rateType = rateType
        self.rateAmount = rateAmount
        self.hoursPerDay = hoursPerDay
        self.mdLimit = mdLimit
        self.contractGroupId = contractGroupId
    }
}

public struct DayOffRow: Equatable, Codable, Sendable {
    public let date: String
    public let kind: String
    public let syncId: String

    public init(date: String, kind: String, syncId: String) {
        self.date = date
        self.kind = kind
        self.syncId = syncId
    }
}

public struct ProjectRow: Equatable, Codable, Sendable {
    public let id: Int
    public let name: String
    public let color: String?
    public let kind: String
    public let isBillable: Bool

    public init(id: Int, name: String, color: String?, kind: String, isBillable: Bool) {
        self.id = id
        self.name = name
        self.color = color
        self.kind = kind
        self.isBillable = isBillable
    }
}

public struct BillingDataset: Equatable, Codable, Sendable {
    public let worklogs: [WorklogRow]
    public let contracts: [ContractRow]
    public let daysOff: [DayOffRow]
    public let projects: [ProjectRow]
    public let tasks: [TaskRow]
    public let epics: [EpicRow]
    public let fetchedAt: String

    public init(worklogs: [WorklogRow], contracts: [ContractRow], daysOff: [DayOffRow],
                projects: [ProjectRow], tasks: [TaskRow], epics: [EpicRow], fetchedAt: String) {
        self.worklogs = worklogs
        self.contracts = contracts
        self.daysOff = daysOff
        self.projects = projects
        self.tasks = tasks
        self.epics = epics
        self.fetchedAt = fetchedAt
    }
}

extension BillingDataset {
    /// Rebuilds the dataset with one or more arrays replaced, copying every
    /// other field through unchanged. `BillingDataset`'s arrays are all
    /// `let` (an immutable snapshot value from the fetch layer), so an
    /// optimistic in-place patch by an editor feature (worklog/task/contract/
    /// day-off form) means constructing a whole new value rather than
    /// mutating a stored array — this is the single shared helper for that,
    /// replacing each editor feature's private `withX` rebuild helper.
    public func replacing(
        worklogs: [WorklogRow]? = nil,
        tasks: [TaskRow]? = nil,
        contracts: [ContractRow]? = nil,
        daysOff: [DayOffRow]? = nil
    ) -> BillingDataset {
        BillingDataset(
            worklogs: worklogs ?? self.worklogs,
            contracts: contracts ?? self.contracts,
            daysOff: daysOff ?? self.daysOff,
            projects: self.projects,
            tasks: tasks ?? self.tasks,
            epics: self.epics,
            fetchedAt: self.fetchedAt
        )
    }
}

// ---------------------------------------------------------------------------
// Attention (escalation reply) models — verbatim port of
// packages/data-supabase/src/attentionCache.ts's `AttentionMessage` /
// `AttentionThread` types. Dates stay opaque ISO strings, never `Date`.
// ---------------------------------------------------------------------------

/// One selectable reply option offered alongside a `claude`-authored
/// attention message. Mirrors the TS `{ number: number; label: string }[]`
/// shape of `AttentionMessage.options` verbatim (NOT `[String]`).
public struct AttentionOption: Equatable, Codable, Sendable {
    public let number: Int
    public let label: String

    public init(number: Int, label: String) {
        self.number = number
        self.label = label
    }
}

public struct AttentionMessage: Equatable, Codable, Sendable {
    public let syncId: String
    public let instanceId: String
    public let projectLabel: String?
    public let role: String          // "claude" | "user"
    public let kind: String?
    public let body: String?
    public let options: [AttentionOption]
    public let replyTo: String?
    public let injectedAt: String?
    public let closedAt: String?
    public let createdAt: String

    public init(syncId: String, instanceId: String, projectLabel: String?, role: String,
                kind: String?, body: String?, options: [AttentionOption], replyTo: String?,
                injectedAt: String?, closedAt: String?, createdAt: String) {
        self.syncId = syncId
        self.instanceId = instanceId
        self.projectLabel = projectLabel
        self.role = role
        self.kind = kind
        self.body = body
        self.options = options
        self.replyTo = replyTo
        self.injectedAt = injectedAt
        self.closedAt = closedAt
        self.createdAt = createdAt
    }
}

/// A grouping of `AttentionMessage` rows sharing an `instanceId`, as produced
/// by `groupThreads`. `label`/`kind` are derived (first message's
/// `projectLabel`, falling back to `instanceId`; last `claude` message's
/// `kind`) — NOT a passthrough `projectLabel` field, matching the TS
/// `AttentionThread` shape exactly (`label: string`, `kind: string | null`).
public struct AttentionThread: Equatable, Codable, Sendable {
    public let instanceId: String
    public let label: String
    public let kind: String?
    public let messages: [AttentionMessage]
    public let unanswered: Bool
    public let closed: Bool

    public init(instanceId: String, label: String, kind: String?, messages: [AttentionMessage],
                unanswered: Bool, closed: Bool) {
        self.instanceId = instanceId
        self.label = label
        self.kind = kind
        self.messages = messages
        self.unanswered = unanswered
        self.closed = closed
    }
}

public struct ProjectEarning: Equatable, Sendable {
    public let projectId: Int
    public let name: String
    public let color: String?
    public let minutes: Double
    public let earnedCzk: Double

    public init(projectId: Int, name: String, color: String?, minutes: Double, earnedCzk: Double) {
        self.projectId = projectId
        self.name = name
        self.color = color
        self.minutes = minutes
        self.earnedCzk = earnedCzk
    }
}
