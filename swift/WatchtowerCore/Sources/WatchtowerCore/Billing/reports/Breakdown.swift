import Foundation

/// Port of `packages/shared/src/billing/reports/breakdown.ts`.
public struct ProjectBreakdownSlice: Equatable, Sendable {
    public let projectId: Int
    public let name: String
    public let color: String?
    public let minutes: Double
    public let earnedCzk: Double
    public let share: Double

    public init(projectId: Int, name: String, color: String?, minutes: Double, earnedCzk: Double, share: Double) {
        self.projectId = projectId
        self.name = name
        self.color = color
        self.minutes = minutes
        self.earnedCzk = earnedCzk
        self.share = share
    }
}

/// In-range (`[from, to]`, no `projectId` filter). Per-project sum of
/// `effectiveMinutes` + `earnedCzk` (non-nil `earnedAmount`). Slices with
/// `minutes <= 0` are dropped before computing `share` (total is the sum of
/// the surviving slices' minutes). Sorted by `minutes` desc, then `name`
/// localized-compare ascending, then first-seen position for determinism.
public func projectBreakdown(_ rows: [WorklogRow], from: String, to: String) -> [ProjectBreakdownSlice] {
    var order: [Int] = []
    var byProject: [Int: (name: String, color: String?, minutes: Double, earnedCzk: Double)] = [:]

    for r in rows {
        if r.workDate < from || r.workDate > to { continue }
        var cur = byProject[r.projectId] ?? (name: r.projectName, color: r.projectColor, minutes: 0, earnedCzk: 0)
        if byProject[r.projectId] == nil {
            order.append(r.projectId)
        }
        cur.minutes += r.effectiveMinutes
        if let earned = r.earnedAmount {
            cur.earnedCzk += earned
        }
        byProject[r.projectId] = cur
    }

    var position: [Int: Int] = [:]
    for (i, pid) in order.enumerated() { position[pid] = i }

    let slices = order.compactMap { pid -> (projectId: Int, name: String, color: String?, minutes: Double, earnedCzk: Double)? in
        guard let s = byProject[pid], s.minutes > 0 else { return nil }
        return (projectId: pid, name: s.name, color: s.color, minutes: s.minutes, earnedCzk: s.earnedCzk)
    }
    let total = slices.reduce(0) { $0 + $1.minutes }

    return slices
        .map { ProjectBreakdownSlice(projectId: $0.projectId, name: $0.name, color: $0.color,
                                      minutes: $0.minutes, earnedCzk: $0.earnedCzk,
                                      share: total > 0 ? $0.minutes / total : 0) }
        .sorted {
            if $0.minutes != $1.minutes { return $0.minutes > $1.minutes }
            let cmp = $0.name.localizedCompare($1.name)
            if cmp != .orderedSame { return cmp == .orderedAscending }
            return (position[$0.projectId] ?? 0) < (position[$1.projectId] ?? 0)
        }
}
