import Foundation

public struct HeatmapDay: Equatable, Sendable {
    public let date: String
    public let minutes: Double

    public init(date: String, minutes: Double) {
        self.date = date
        self.minutes = minutes
    }
}

public struct HeatmapStats: Equatable, Sendable {
    public let currentStreak: Int
    public let longestStreak: Int
    public let activeDays: Int
    public let weeklyAvgMinutes: Int
    public let busiestDay: String?

    public init(currentStreak: Int, longestStreak: Int, activeDays: Int,
                weeklyAvgMinutes: Int, busiestDay: String?) {
        self.currentStreak = currentStreak
        self.longestStreak = longestStreak
        self.activeDays = activeDays
        self.weeklyAvgMinutes = weeklyAvgMinutes
        self.busiestDay = busiestDay
    }
}

public struct HeatmapResult: Equatable, Sendable {
    public let days: [HeatmapDay]
    public let stats: HeatmapStats

    public init(days: [HeatmapDay], stats: HeatmapStats) {
        self.days = days
        self.stats = stats
    }
}

// UTC calendar for all date-string arithmetic (never local zone).
private let heatmapUtcCal: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "UTC")!
    return c
}()

private func heatmapDate(_ ymd: String) -> Date {
    let p = ymd.split(separator: "-").compactMap { Int($0) }
    return heatmapUtcCal.date(from: DateComponents(year: p[0], month: p[1], day: p[2]))!
}

private func heatmapAddDays(_ ymd: String, _ delta: Int) -> String {
    let dt = heatmapUtcCal.date(byAdding: .day, value: delta, to: heatmapDate(ymd))!
    let c = heatmapUtcCal.dateComponents([.year, .month, .day], from: dt)
    return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
}

/// Port of `packages/shared/src/billing/heatmap.ts` `buildHeatmap`.
private func buildHeatmap(_ rows: [WorklogRow], fromDate: String, toDate: String) -> HeatmapResult {
    // Aggregate raw minutes per date (mirrors SQL SUM(w.minutes) GROUP BY work_date).
    var grouped: [String: Double] = [:]
    for row in rows where row.workDate >= fromDate && row.workDate <= toDate {
        grouped[row.workDate, default: 0] += row.minutes
    }

    // Zero-fill the inclusive [fromDate, toDate] window.
    var days: [HeatmapDay] = []
    var cursor = fromDate
    while cursor <= toDate {
        days.append(HeatmapDay(date: cursor, minutes: grouped[cursor] ?? 0))
        cursor = heatmapAddDays(cursor, 1)
    }
    let windowDays = days.count
    let map = Dictionary(uniqueKeysWithValues: days.map { ($0.date, $0.minutes) })

    let activeDays = days.filter { $0.minutes > 0 }.count
    let totalMinutes = days.reduce(0) { $0 + $1.minutes }
    let weeklyAvgMinutes = windowDays > 0 ? Int(((totalMinutes / Double(windowDays)) * 7).rounded()) : 0

    // currentStreak: walk backward from toDate while minutes > 0.
    var streakCursor = toDate
    var currentStreak = 0
    while let m = map[streakCursor], m > 0 {
        currentStreak += 1
        streakCursor = heatmapAddDays(streakCursor, -1)
    }

    // longestStreak: longest run of minutes > 0 in the window.
    var longestStreak = 0
    var run = 0
    for d in days {
        if d.minutes > 0 {
            run += 1
            if run > longestStreak { longestStreak = run }
        } else {
            run = 0
        }
    }

    // busiestDay: first date with max minutes > 0; nil if none.
    var busiestDay: String?
    var busiestMinutes: Double = 0
    for d in days {
        if d.minutes > 0 && (busiestDay == nil || d.minutes > busiestMinutes) {
            busiestDay = d.date
            busiestMinutes = d.minutes
        }
    }

    return HeatmapResult(
        days: days,
        stats: HeatmapStats(currentStreak: currentStreak, longestStreak: longestStreak,
                            activeDays: activeDays, weeklyAvgMinutes: weeklyAvgMinutes,
                            busiestDay: busiestDay)
    )
}

/// Mirrors `dashboardOverview.ts:heatmap30d` + `computeStats`.
/// window = [today-(windowDays-1), today] inclusive.
public func activityHeatmap(_ rows: [WorklogRow], today: String, windowDays: Int = 30) -> HeatmapResult {
    let fromDate = heatmapAddDays(today, -(windowDays - 1))
    return buildHeatmap(rows, fromDate: fromDate, toDate: today)
}

/// Range-scoped variant: caller supplies the inclusive [from, to] window directly
/// (mirrors `packages/shared/src/billing/heatmap.ts` `activityHeatmapRange`).
public func activityHeatmapRange(_ rows: [WorklogRow], from: String, to: String) -> HeatmapResult {
    buildHeatmap(rows, fromDate: from, toDate: to)
}
