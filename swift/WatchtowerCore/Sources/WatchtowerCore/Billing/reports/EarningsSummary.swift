import Foundation

/// Port of `packages/shared/src/billing/reports/earnings-summary.ts`.
public struct EarningsSummaryResult: Equatable, Sendable {
    public let totalCzk: Double
    public let billableMinutes: Double
    public let unbillableMinutes: Double
    public let avgEffectiveHourlyRateCzk: Double?
    public let perProject: [ProjectEarning]

    public init(totalCzk: Double, billableMinutes: Double, unbillableMinutes: Double,
                avgEffectiveHourlyRateCzk: Double?, perProject: [ProjectEarning]) {
        self.totalCzk = totalCzk
        self.billableMinutes = billableMinutes
        self.unbillableMinutes = unbillableMinutes
        self.avgEffectiveHourlyRateCzk = avgEffectiveHourlyRateCzk
        self.perProject = perProject
    }
}

private func isCzkEarned(_ r: WorklogRow) -> Bool {
    r.earnedAmount != nil
}

/// In-range (`[from, to]`) + optional `projectId` filter. `billableMinutes` /
/// `unbillableMinutes` sum `effectiveMinutes` for work-kind rows only, split
/// by `isBillable`. Any billable row with a non-nil `earnedAmount` (work or
/// personal kind) contributes to `totalCzk`, the czk-billable-minutes
/// denominator, and `perProject` — but not to `billableMinutes`/
/// `unbillableMinutes` unless it's also work-kind.
public func earningsSummary(
    _ rows: [WorklogRow], from: String, to: String, projectId: Int?
) -> EarningsSummaryResult {
    var totalCzk: Double = 0
    var czkBillableMinutes: Double = 0
    var billableMinutes: Double = 0
    var unbillableMinutes: Double = 0
    var order: [Int] = []
    var byProject: [Int: ProjectEarning] = [:]

    for r in rows {
        if r.workDate < from || r.workDate > to { continue }
        if let projectId, r.projectId != projectId { continue }

        if r.projectKind == "work" && r.isBillable { billableMinutes += r.effectiveMinutes }
        if r.projectKind == "work" && !r.isBillable { unbillableMinutes += r.effectiveMinutes }

        if r.isBillable && isCzkEarned(r) {
            totalCzk += r.earnedAmount!
            czkBillableMinutes += r.effectiveMinutes
            var cur = byProject[r.projectId] ?? ProjectEarning(projectId: r.projectId, name: r.projectName, color: r.projectColor, minutes: 0, earnedCzk: 0)
            if byProject[r.projectId] == nil {
                order.append(r.projectId)
            }
            cur = ProjectEarning(projectId: cur.projectId, name: cur.name, color: cur.color,
                                  minutes: cur.minutes + r.effectiveMinutes, earnedCzk: cur.earnedCzk + r.earnedAmount!)
            byProject[r.projectId] = cur
        }
    }

    let avgEffectiveHourlyRateCzk = czkBillableMinutes > 0 ? totalCzk / (czkBillableMinutes / 60) : nil

    var position: [Int: Int] = [:]
    for (i, pid) in order.enumerated() { position[pid] = i }
    let perProject = order.compactMap { byProject[$0] }
        .sorted {
            $0.earnedCzk != $1.earnedCzk
                ? $0.earnedCzk > $1.earnedCzk
                : (position[$0.projectId] ?? 0) < (position[$1.projectId] ?? 0)
        }

    return EarningsSummaryResult(totalCzk: totalCzk, billableMinutes: billableMinutes,
                                  unbillableMinutes: unbillableMinutes,
                                  avgEffectiveHourlyRateCzk: avgEffectiveHourlyRateCzk,
                                  perProject: perProject)
}
