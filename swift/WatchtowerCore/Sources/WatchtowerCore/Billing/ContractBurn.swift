import Foundation

/// Contract burn / MD projection.
///
/// Ported from `packages/shared/src/billing/contracts.ts` (`contractBurn`),
/// which itself mirrors `orchestrator/db/contractStatus.ts:forRate`. Math
/// mirrors the TypeScript exactly so the iOS billing dashboard shows the
/// same numbers as the desktop ContractsTab.
public struct ContractBurn: Equatable, Sendable {
    public let projectId: Int
    public let projectName: String
    public let projectColor: String?
    public let mdsUsed: Double
    public let mdLimit: Double?
    public let mdsRemaining: Double?
    public let projectedMds: Double?
    public let workdaysRemaining: Int?
    public let totalWorkdays: Int?
    public let endDate: String?
    /// Shared-contract group id — nil for a solo (non-pooled) contract.
    /// A pooled group returns one ContractBurn PER member project, all
    /// carrying the same pooled mdsUsed/mdLimit — consumers that render a
    /// card per entry must dedupe on this field (caller's job — Task 14).
    public let contractGroupId: String?

    public init(projectId: Int, projectName: String, projectColor: String?, mdsUsed: Double,
                mdLimit: Double?, mdsRemaining: Double?, projectedMds: Double?,
                workdaysRemaining: Int?, totalWorkdays: Int?, endDate: String?,
                contractGroupId: String?) {
        self.projectId = projectId
        self.projectName = projectName
        self.projectColor = projectColor
        self.mdsUsed = mdsUsed
        self.mdLimit = mdLimit
        self.mdsRemaining = mdsRemaining
        self.projectedMds = projectedMds
        self.workdaysRemaining = workdaysRemaining
        self.totalWorkdays = totalWorkdays
        self.endDate = endDate
        self.contractGroupId = contractGroupId
    }
}

private func round2(_ n: Double) -> Double {
    // Mirror JS Math.round exactly (round half toward +∞), so a negative
    // over-budget mdsRemaining matches the TypeScript source at half-cent
    // boundaries. Swift's bare .rounded() is away-from-zero and would diverge
    // for negative values.
    ((n * 100 + 0.5).rounded(.down)) / 100
}

private func ymd(_ d: Date, _ cal: Calendar) -> String {
    let c = cal.dateComponents([.year, .month, .day], from: d)
    return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
}

// UTC calendar for all date-string arithmetic (never local zone) — matches Workdays.swift.
private let utcCal: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "UTC")!
    return c
}()

private func addDay(_ date: String) -> String {
    let parts = date.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3 else { return date }
    guard let d = utcCal.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else {
        return date
    }
    let next = utcCal.date(byAdding: .day, value: 1, to: d)!
    return ymd(next, utcCal)
}

private func minDate(_ a: String, _ b: String) -> String {
    a <= b ? a : b
}

/// Compute burn / projection for each *active* contract.
/// Active = `effectiveFrom <= today` AND (`endDate` nil OR `endDate >= today`).
///
/// - Parameters:
///   - contracts: One entry per project_rate row (all time windows).
///   - rows: Denormalised worklog rows (incl. effectiveMinutes).
///   - daysOff: User-marked days off — all kinds contribute to extraNonWorking.
///   - projects: Full project list — used to resolve projectName/projectColor.
///   - today: YYYY-MM-DD string (injected for testability).
public func contractBurn(
    _ contracts: [ContractRow],
    _ rows: [WorklogRow],
    _ daysOff: [DayOffRow],
    _ projects: [ProjectRow],
    today: String
) -> [ContractBurn] {
    // Build a lookup of project metadata from the projects list.
    var projectMap: [Int: ProjectRow] = [:]
    for p in projects {
        projectMap[p.id] = p
    }

    // Pre-build the extra-non-working set from all daysOff.
    let extraNonWorking = Set(daysOff.map { $0.date })

    var result: [ContractBurn] = []

    for rate in contracts {
        // Active filter: isActive = today >= effectiveFrom && (endDate nil || today <= endDate)
        let effectiveTo = rate.endDate
        let isActive = today >= rate.effectiveFrom && (effectiveTo == nil || today <= effectiveTo!)
        if !isActive { continue }

        // periodEnd: for elapsed we cap at today when open-ended.
        let periodEnd = rate.endDate ?? today

        // A shared contract's mdLimit is one budget pooled across every project
        // linked to the group — sum worklogs across all member ids, not just this
        // rate's own project. Solo contracts (no group) fall back to the single
        // project id.
        let memberIds: Set<Int>
        if let groupId = rate.contractGroupId {
            memberIds = Set(contracts.filter { $0.contractGroupId == groupId }.map { $0.projectId })
        } else {
            memberIds = [rate.projectId]
        }

        // minutesLogged = sum effectiveMinutes across member projects within [effectiveFrom, periodEnd]
        var minutesLogged = 0.0
        for r in rows {
            if memberIds.contains(r.projectId),
               r.workDate >= rate.effectiveFrom,
               r.workDate <= periodEnd,
               r.projectKind == "work" {
                minutesLogged += r.effectiveMinutes
            }
        }

        // mdsUsed
        let mdsUsed = round2(minutesLogged / 60 / rate.hoursPerDay)

        // mdsRemaining
        let mdsRemaining: Double? = rate.mdLimit != nil ? round2(rate.mdLimit! - mdsUsed) : nil

        // elapsedWorkdays: countWorkdays(effectiveFrom, min(today, periodEnd))
        let elapsedWorkdays = countWorkdays(
            rate.effectiveFrom,
            minDate(today, periodEnd),
            extraNonWorking
        )

        // totalWorkdays: nil when open-ended
        let totalWorkdays: Int? = effectiveTo != nil
            ? countWorkdays(rate.effectiveFrom, effectiveTo!, extraNonWorking)
            : nil

        // workdaysRemaining:
        // endDate exists && today <= endDate → countWorkdays(tomorrow, endDate)
        // endDate exists && today > endDate → 0
        // no endDate → nil
        let workdaysRemaining: Int?
        if let end = effectiveTo, today <= end {
            workdaysRemaining = countWorkdays(addDay(today), end, extraNonWorking)
        } else if effectiveTo != nil {
            workdaysRemaining = 0
        } else {
            workdaysRemaining = nil
        }

        // projectedMds: mirror projectedTotalMds
        let projectedMds: Double?
        if let total = totalWorkdays, elapsedWorkdays > 0 {
            projectedMds = round2((mdsUsed / Double(elapsedWorkdays)) * Double(total))
        } else {
            projectedMds = nil
        }

        let proj = projectMap[rate.projectId]
        result.append(ContractBurn(
            projectId: rate.projectId,
            projectName: proj?.name ?? "",
            projectColor: proj?.color,
            mdsUsed: mdsUsed,
            mdLimit: rate.mdLimit,
            mdsRemaining: mdsRemaining,
            projectedMds: projectedMds,
            workdaysRemaining: workdaysRemaining,
            totalWorkdays: totalWorkdays,
            endDate: rate.endDate,
            contractGroupId: rate.contractGroupId
        ))
    }

    return result
}
