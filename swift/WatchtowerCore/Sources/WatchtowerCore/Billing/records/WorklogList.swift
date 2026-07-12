import Foundation

/// A single day's worklog entries — mirrors `packages/shared/src/billing/records/worklog-list.ts`.
public struct WorklogDay: Equatable, Sendable {
    public let date: String
    public let totalMinutes: Double
    public let entries: [WorklogRow]

    public init(date: String, totalMinutes: Double, entries: [WorklogRow]) {
        self.date = date
        self.totalMinutes = totalMinutes
        self.entries = entries
    }
}

/// Groups `rows` by `workDate` within `month` (YYYY-MM prefix), optionally
/// scoped to `projectId`. Sums raw `minutes` (not `effectiveMinutes`).
/// Entries keep encounter order within a day. Result is sorted descending
/// by date (newest day first).
public func groupWorklogsByDay(
    _ rows: [WorklogRow], month: String, projectId: Int?
) -> [WorklogDay] {
    var byDate: [String: WorklogDay] = [:]
    var order: [String] = []
    for r in rows {
        guard r.workDate.prefix(7) == month else { continue }
        if let projectId, r.projectId != projectId { continue }
        if byDate[r.workDate] == nil {
            byDate[r.workDate] = WorklogDay(date: r.workDate, totalMinutes: 0, entries: [])
            order.append(r.workDate)
        }
        let day = byDate[r.workDate]!
        byDate[r.workDate] = WorklogDay(
            date: day.date,
            totalMinutes: day.totalMinutes + r.minutes,
            entries: day.entries + [r]
        )
    }
    return order.map { byDate[$0]! }.sorted { $0.date > $1.date }
}
