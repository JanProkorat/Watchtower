import Foundation

// ---------------------------------------------------------------------------
// PostgREST response DTOs — mirror the nested embedded-select shapes used by
// packages/data-supabase/src/billingCache.ts. Snake_case wire fields decoded
// via explicit CodingKeys for clarity at the call site.
// ---------------------------------------------------------------------------

struct RawProjectDTO: Decodable {
    let id: Int
    let name: String
    let color: String?
    let kind: String
    let isBillable: Bool

    enum CodingKeys: String, CodingKey {
        case id, name, color, kind
        case isBillable = "is_billable"
    }
}

struct RawEpicDTO: Decodable {
    let projects: RawProjectDTO?
}

struct RawTaskDTO: Decodable {
    let number: String?
    let title: String?
    let epics: RawEpicDTO?
}

/// `worklogs?select=sync_id,work_date,minutes,effective_minutes,earned_amount,...,
///   tasks(number,title,epics(projects(id,name,color,kind,is_billable)))`
struct WorklogDTO: Decodable {
    let syncId: String
    let workDate: String
    let minutes: Double
    let effectiveMinutes: Double
    let earnedAmount: Double?
    let reportedMinutes: Double?
    let description: String?
    let source: String?
    let tasks: RawTaskDTO?

    enum CodingKeys: String, CodingKey {
        case syncId = "sync_id"
        case workDate = "work_date"
        case minutes
        case effectiveMinutes = "effective_minutes"
        case earnedAmount = "earned_amount"
        case reportedMinutes = "reported_minutes"
        case description
        case source
        case tasks
    }
}

/// `tasks?select=id,sync_id,epic_id,number,title,status,estimated_minutes,
///   jira_estimate_secs,jira_status,description,epics(projects(...))`
struct TaskDTO: Decodable {
    let id: Int
    let syncId: String
    let epicId: Int
    let number: String?
    let title: String?
    let status: String
    let estimatedMinutes: Int?
    let jiraEstimateSecs: Int?
    let jiraStatus: String?
    let description: String?
    let epics: RawEpicDTO?

    enum CodingKeys: String, CodingKey {
        case id
        case syncId = "sync_id"
        case epicId = "epic_id"
        case number, title, status
        case estimatedMinutes = "estimated_minutes"
        case jiraEstimateSecs = "jira_estimate_secs"
        case jiraStatus = "jira_status"
        case description
        case epics
    }
}

/// `epics?select=id,name,project_id,status`
struct EpicDTO: Decodable {
    let id: Int
    let name: String
    let projectId: Int
    let status: String

    enum CodingKeys: String, CodingKey {
        case id, name, status
        case projectId = "project_id"
    }
}

/// `contracts?select=sync_id,project_id,effective_from,end_date,rate_type,
///   rate_amount,hours_per_day,md_limit,contract_group_id`
struct ContractDTO: Decodable {
    let syncId: String
    let projectId: Int
    let effectiveFrom: String
    let endDate: String?
    let rateType: String
    let rateAmount: Double
    let hoursPerDay: Double
    let mdLimit: Double?
    let contractGroupId: String?

    enum CodingKeys: String, CodingKey {
        case syncId = "sync_id"
        case projectId = "project_id"
        case effectiveFrom = "effective_from"
        case endDate = "end_date"
        case rateType = "rate_type"
        case rateAmount = "rate_amount"
        case hoursPerDay = "hours_per_day"
        case mdLimit = "md_limit"
        case contractGroupId = "contract_group_id"
    }
}

/// `days_off?select=date,kind,sync_id`
struct DayOffDTO: Decodable {
    let date: String
    let kind: String
    let syncId: String

    enum CodingKeys: String, CodingKey {
        case date, kind
        case syncId = "sync_id"
    }
}

/// `projects?select=id,name,color,kind,is_billable`
struct ProjectDTO: Decodable {
    let id: Int
    let name: String
    let color: String?
    let kind: String
    let isBillable: Bool

    enum CodingKeys: String, CodingKey {
        case id, name, color, kind
        case isBillable = "is_billable"
    }
}

// ---------------------------------------------------------------------------
// Mapper — flattens each DTO into the Task 3 flat row models.
// ---------------------------------------------------------------------------

enum BillingMapper {
    static func worklog(_ dto: WorklogDTO) -> WorklogRow {
        let task = dto.tasks
        let proj = task?.epics?.projects

        return WorklogRow(
            syncId: dto.syncId,
            workDate: dto.workDate,
            minutes: dto.minutes,
            reportedMinutes: dto.reportedMinutes,
            effectiveMinutes: dto.effectiveMinutes,
            earnedAmount: dto.earnedAmount,
            description: dto.description,
            projectId: proj?.id ?? 0,
            projectName: proj?.name ?? "",
            projectColor: proj?.color,
            projectKind: proj?.kind ?? "",
            isBillable: proj?.isBillable ?? false,
            taskNumber: task?.number,
            taskTitle: task?.title,
            source: dto.source
        )
    }

    static func task(_ dto: TaskDTO) -> TaskRow {
        let proj = dto.epics?.projects
        let estimatedMinutes = dto.estimatedMinutes
            ?? dto.jiraEstimateSecs.map { Int((Double($0) / 60).rounded()) }

        return TaskRow(
            taskId: dto.id,
            syncId: dto.syncId,
            epicId: dto.epicId,
            taskNumber: dto.number,
            taskTitle: dto.title ?? "",
            status: dto.status,
            estimatedMinutes: estimatedMinutes,
            description: dto.description,
            projectId: proj?.id ?? 0,
            projectName: proj?.name ?? "",
            projectColor: proj?.color,
            projectKind: proj?.kind ?? "",
            isBillable: proj?.isBillable ?? false,
            jiraStatus: dto.jiraStatus
        )
    }

    static func epic(_ dto: EpicDTO) -> EpicRow {
        EpicRow(epicId: dto.id, name: dto.name, projectId: dto.projectId, status: dto.status)
    }

    static func contract(_ dto: ContractDTO) -> ContractRow {
        ContractRow(
            syncId: dto.syncId,
            projectId: dto.projectId,
            effectiveFrom: dto.effectiveFrom,
            endDate: dto.endDate,
            rateType: dto.rateType,
            rateAmount: dto.rateAmount,
            hoursPerDay: dto.hoursPerDay,
            mdLimit: dto.mdLimit,
            contractGroupId: dto.contractGroupId
        )
    }

    static func dayOff(_ dto: DayOffDTO) -> DayOffRow {
        DayOffRow(date: dto.date, kind: dto.kind, syncId: dto.syncId)
    }

    static func project(_ dto: ProjectDTO) -> ProjectRow {
        ProjectRow(id: dto.id, name: dto.name, color: dto.color, kind: dto.kind, isBillable: dto.isBillable)
    }
}
