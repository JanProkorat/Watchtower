import Foundation

/// A single task's per-day minute breakdown within a month — mirrors
/// `packages/shared/src/billing/records/task-grid.ts`'s `TaskGridRow`.
public struct TaskGridRow: Equatable, Sendable {
    public let key: String
    public let projectId: Int
    public let taskNumber: String?
    public let taskTitle: String?
    public let projectColor: String?
    public let perDay: [Double]
    /// Expected time for the task, in minutes. Manual estimate wins; falls
    /// back to the estimate pulled from Jira (see `estimatesByKey`). Nil
    /// when neither is known. Mirrors the desktop grid's `estimatedMinutes`.
    public let estimatedMinutes: Int?

    public init(
        key: String, projectId: Int, taskNumber: String?, taskTitle: String?,
        projectColor: String?, perDay: [Double], estimatedMinutes: Int?
    ) {
        self.key = key
        self.projectId = projectId
        self.taskNumber = taskNumber
        self.taskTitle = taskTitle
        self.projectColor = projectColor
        self.perDay = perDay
        self.estimatedMinutes = estimatedMinutes
    }
}

/// Result of `buildTaskGrid` — mirrors `task-grid.ts`'s `TaskGridResult`.
public struct TaskGridResult: Equatable, Sendable {
    public let tasks: [TaskGridRow]
    public let dailyTotals: [Double]
    public let dailyEarnings: [Double]
    public let monthTotalMinutes: Double
    public let monthTotalCzk: Double
    public let daysInMonth: Int

    public init(
        tasks: [TaskGridRow], dailyTotals: [Double], dailyEarnings: [Double],
        monthTotalMinutes: Double, monthTotalCzk: Double, daysInMonth: Int
    ) {
        self.tasks = tasks
        self.dailyTotals = dailyTotals
        self.dailyEarnings = dailyEarnings
        self.monthTotalMinutes = monthTotalMinutes
        self.monthTotalCzk = monthTotalCzk
        self.daysInMonth = daysInMonth
    }
}

/// Builds the task x day matrix for `month` (YYYY-MM), optionally scoped to
/// `projectIds` (empty = all projects). Port of `task-grid.ts`'s
/// `buildTaskGrid` — the desktop app's legacy single `projectId` filter is
/// dropped; the app only ever calls with `projectIds`.
public func buildTaskGrid(
    _ rows: [WorklogRow], month: String, projectIds: [Int], estimatesByKey: [String: Int?]
) -> TaskGridResult {
    let projectFilter: Set<Int>? = projectIds.isEmpty ? nil : Set(projectIds)

    let parts = month.split(separator: "-").compactMap { Int($0) }
    let year = parts[0]
    let monthNum = parts[1]

    // Last day of `monthNum` in `year`, computed with a UTC calendar so the
    // month boundary matches the JS `new Date(Date.UTC(y, m, 0)).getUTCDate()`.
    var utcCalendar = Calendar(identifier: .gregorian)
    utcCalendar.timeZone = TimeZone(identifier: "UTC")!
    let components = DateComponents(year: year, month: monthNum, day: 1)
    let firstOfMonth = utcCalendar.date(from: components)!
    let daysInMonth = utcCalendar.range(of: .day, in: .month, for: firstOfMonth)!.count

    var byTask: [String: TaskGridRow] = [:]
    var order: [String] = []
    var dailyTotals = [Double](repeating: 0, count: daysInMonth)
    var dailyEarnings = [Double](repeating: 0, count: daysInMonth)
    var monthTotalMinutes: Double = 0
    var monthTotalCzk: Double = 0

    for r in rows {
        guard r.workDate.prefix(7) == month else { continue }
        if let projectFilter, !projectFilter.contains(r.projectId) { continue }
        let dayIdxString = r.workDate[r.workDate.index(r.workDate.startIndex, offsetBy: 8)...]
        let dayIdx = (Int(dayIdxString.prefix(2)) ?? 1) - 1
        let key = "\(r.projectId):\(r.taskNumber ?? "")"

        if byTask[key] == nil {
            byTask[key] = TaskGridRow(
                key: key,
                projectId: r.projectId,
                taskNumber: r.taskNumber,
                taskTitle: r.taskTitle,
                projectColor: r.projectColor,
                perDay: [Double](repeating: 0, count: daysInMonth),
                estimatedMinutes: estimatesByKey[key] ?? nil
            )
            order.append(key)
        }

        var row = byTask[key]!
        var perDay = row.perDay
        perDay[dayIdx] += r.minutes
        row = TaskGridRow(
            key: row.key, projectId: row.projectId, taskNumber: row.taskNumber,
            taskTitle: row.taskTitle, projectColor: row.projectColor,
            perDay: perDay, estimatedMinutes: row.estimatedMinutes
        )
        byTask[key] = row

        dailyTotals[dayIdx] += r.minutes
        monthTotalMinutes += r.minutes
        // Earnings gate on isBillable (not just earnedAmount != nil): earnedAmount is
        // resolved from any matching contract regardless of billability, so a
        // non-billable project with a rate would otherwise inflate grid totals past
        // the Earnings/Reports tabs (earnings-summary.ts uses the same isBillable
        // gate) and the desktop grid.
        if r.isBillable, let earnedAmount = r.earnedAmount {
            dailyEarnings[dayIdx] += earnedAmount
            monthTotalCzk += earnedAmount
        }
    }

    let tasks = order.map { byTask[$0]! }.sorted { a, b in
        if a.projectId != b.projectId { return a.projectId < b.projectId }
        return (a.taskNumber ?? "").localizedStandardCompare(b.taskNumber ?? "") == .orderedAscending
    }

    return TaskGridResult(
        tasks: tasks, dailyTotals: dailyTotals, dailyEarnings: dailyEarnings,
        monthTotalMinutes: monthTotalMinutes, monthTotalCzk: monthTotalCzk, daysInMonth: daysInMonth
    )
}
