import Foundation

private func inMonth(_ workDate: String, _ month: String) -> Bool {
    String(workDate.prefix(7)) == month
}

private func isCzkEarned(_ r: WorklogRow) -> Bool {
    r.earnedAmount != nil
}

/// Port of `packages/shared/src/billing/earnings.ts` `aggregateMonthEarnings`.
/// `perProject` is sorted by `earnedCzk` descending; `totalCzk` sums only
/// rows with non-nil `earnedAmount` in `month`.
public func aggregateMonthEarnings(_ rows: [WorklogRow], _ month: String) -> (totalCzk: Double, perProject: [ProjectEarning]) {
    var order: [Int] = []
    var byProject: [Int: ProjectEarning] = [:]
    var totalCzk: Double = 0

    for r in rows {
        guard inMonth(r.workDate, month) else { continue }
        var cur = byProject[r.projectId] ?? ProjectEarning(projectId: r.projectId, name: r.projectName, color: r.projectColor, minutes: 0, earnedCzk: 0)
        if byProject[r.projectId] == nil {
            order.append(r.projectId)
        }
        cur = ProjectEarning(projectId: cur.projectId, name: cur.name, color: cur.color,
                              minutes: cur.minutes + r.minutes, earnedCzk: cur.earnedCzk)
        if isCzkEarned(r) {
            cur = ProjectEarning(projectId: cur.projectId, name: cur.name, color: cur.color,
                                  minutes: cur.minutes, earnedCzk: cur.earnedCzk + r.earnedAmount!)
            totalCzk += r.earnedAmount!
        }
        byProject[r.projectId] = cur
    }

    var position: [Int: Int] = [:]
    for (i, pid) in order.enumerated() { position[pid] = i }
    let perProject = order.compactMap { byProject[$0] }
        .sorted {
            $0.earnedCzk != $1.earnedCzk
                ? $0.earnedCzk > $1.earnedCzk
                : (position[$0.projectId] ?? 0) < (position[$1.projectId] ?? 0)
        }
    return (totalCzk, perProject)
}

/// Port of `trailingMonths`: the `n` months ending at `endMonth` (ascending),
/// each summing non-nil `earnedAmount`, zero-filled for months with no rows.
public func trailingMonths(_ rows: [WorklogRow], _ endMonth: String, _ n: Int) -> [(month: String, earnedCzk: Double)] {
    let months = (0..<n).map { CzFormat.addMonths(endMonth, -(n - 1 - $0)) }
    var totals: [String: Double] = Dictionary(uniqueKeysWithValues: months.map { ($0, 0) })

    for r in rows {
        guard isCzkEarned(r) else { continue }
        let m = String(r.workDate.prefix(7))
        if totals[m] != nil {
            totals[m]! += r.earnedAmount!
        }
    }

    return months.map { (month: $0, earnedCzk: totals[$0]!) }
}

/// Port of `topProjects`: filter `minutes > 0`, sort `minutes` desc then
/// `name` ascending, take `limit`.
public func topProjects(_ rows: [WorklogRow], _ month: String, _ limit: Int) -> [ProjectEarning] {
    var order: [Int] = []
    var byProject: [Int: ProjectEarning] = [:]

    for r in rows {
        guard inMonth(r.workDate, month) else { continue }
        var cur = byProject[r.projectId] ?? ProjectEarning(projectId: r.projectId, name: r.projectName, color: r.projectColor, minutes: 0, earnedCzk: 0)
        if byProject[r.projectId] == nil {
            order.append(r.projectId)
        }
        cur = ProjectEarning(projectId: cur.projectId, name: cur.name, color: cur.color,
                              minutes: cur.minutes + r.minutes, earnedCzk: cur.earnedCzk)
        if isCzkEarned(r) {
            cur = ProjectEarning(projectId: cur.projectId, name: cur.name, color: cur.color,
                                  minutes: cur.minutes, earnedCzk: cur.earnedCzk + r.earnedAmount!)
        }
        byProject[r.projectId] = cur
    }

    var position: [Int: Int] = [:]
    for (i, pid) in order.enumerated() { position[pid] = i }
    return order.compactMap { byProject[$0] }
        .filter { $0.minutes > 0 }
        .sorted {
            if $0.minutes != $1.minutes { return $0.minutes > $1.minutes }
            if $0.name != $1.name { return $0.name.localizedCompare($1.name) == .orderedAscending }
            return (position[$0.projectId] ?? 0) < (position[$1.projectId] ?? 0)
        }
        .prefix(limit)
        .map { $0 }
}
