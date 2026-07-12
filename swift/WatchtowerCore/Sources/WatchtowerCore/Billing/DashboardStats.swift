import Foundation

public struct KpiAgg: Equatable, Sendable {
    public let minutes: Double
    public let earnedCzk: Double

    public init(minutes: Double, earnedCzk: Double) {
        self.minutes = minutes
        self.earnedCzk = earnedCzk
    }
}

public struct SprintWindow: Equatable, Sendable {
    public let from: String
    public let to: String

    public init(from: String, to: String) {
        self.from = from
        self.to = to
    }
}

public struct DashboardKpis: Equatable, Sendable {
    public let today: KpiAgg
    public let sprint: KpiAgg
    public let sprintWindow: SprintWindow
    public let month: KpiAgg

    public init(today: KpiAgg, sprint: KpiAgg, sprintWindow: SprintWindow, month: KpiAgg) {
        self.today = today
        self.sprint = sprint
        self.sprintWindow = sprintWindow
        self.month = month
    }
}

// UTC calendar for all date-string arithmetic (never local zone).
private let dashboardUtcCal: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "UTC")!
    return c
}()

private func dashboardDate(_ ymd: String) -> Date {
    let p = ymd.split(separator: "-").compactMap { Int($0) }
    return dashboardUtcCal.date(from: DateComponents(year: p[0], month: p[1], day: p[2]))!
}

/// Whole-day count from `Date.UTC` epoch, matching the JS `toUTC(d) / DAY` semantics
/// (i.e. days-since-epoch for a UTC midnight date).
private func daysSinceEpochUTC(_ ymd: String) -> Int {
    let dt = dashboardDate(ymd)
    let epoch = dashboardUtcCal.date(from: DateComponents(year: 1970, month: 1, day: 1))!
    return dashboardUtcCal.dateComponents([.day], from: epoch, to: dt).day!
}

private func addDaysToYmd(_ ymd: String, _ delta: Int) -> String {
    let dt = dashboardUtcCal.date(byAdding: .day, value: delta, to: dashboardDate(ymd))!
    let c = dashboardUtcCal.dateComponents([.year, .month, .day], from: dt)
    return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
}

/// Port of `packages/shared/src/billing/dashboard.ts` `sprintWindow`.
public func sprintWindow(_ anchor: String, startDate: String = "2026-01-05", lengthDays: Int = 14) -> SprintWindow {
    let len = min(56, max(1, lengthDays))
    let days = daysSinceEpochUTC(anchor) - daysSinceEpochUTC(startDate)
    let idx = Int(floor(Double(days) / Double(len)))
    let from = addDaysToYmd(startDate, idx * len)
    let to = addDaysToYmd(from, len - 1)
    return SprintWindow(from: from, to: to)
}

private func kpiAgg(_ rows: [WorklogRow], _ predicate: (WorklogRow) -> Bool) -> KpiAgg {
    var minutes: Double = 0
    var earnedCzk: Double = 0
    for r in rows {
        guard predicate(r) else { continue }
        minutes += r.minutes
        if let earned = r.earnedAmount {
            earnedCzk += earned
        }
    }
    return KpiAgg(minutes: minutes, earnedCzk: earnedCzk)
}

/// Port of `packages/shared/src/billing/dashboard.ts` `dashboardKpis`.
public func dashboardKpis(_ rows: [WorklogRow], today: String) -> DashboardKpis {
    let month = String(today.prefix(7))
    let sw = sprintWindow(today)
    let todayAgg = kpiAgg(rows) { $0.workDate == today }
    let sprintAgg = kpiAgg(rows) { $0.workDate >= sw.from && $0.workDate <= sw.to }
    let monthAgg = kpiAgg(rows) { $0.workDate.prefix(7) == month }
    return DashboardKpis(today: todayAgg, sprint: sprintAgg, sprintWindow: sw, month: monthAgg)
}
