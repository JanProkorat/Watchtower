import Foundation

/// Report date-range preset — mirrors `packages/module-timetracker/src/useReportsFilters.ts`.
public enum Preset: String, CaseIterable, Sendable, Equatable {
    case d7 = "7d", d30 = "30d", month, year, all
}

private func parseReportYmd(_ date: String) -> (y: Int, m: Int, d: Int)? {
    let parts = date.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3 else { return nil }
    return (parts[0], parts[1], parts[2])
}

private func makeReportDate(_ y: Int, _ m: Int, _ d: Int) -> Date {
    utcCalendarForReports.date(from: DateComponents(year: y, month: m, day: d))!
}

// UTC calendar for all date-string arithmetic (never local zone).
private let utcCalendarForReports: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "UTC")!
    return c
}()

/// Adds `n` days (may be negative) to a `YYYY-MM-DD` date string, in UTC.
public func addDaysUTC(_ date: String, _ n: Int) -> String {
    guard let (y, m, d) = parseReportYmd(date) else { return date }
    let dt = utcCalendarForReports.date(byAdding: .day, value: n, to: makeReportDate(y, m, d))!
    let c = utcCalendarForReports.dateComponents([.year, .month, .day], from: dt)
    return "\(c.year!)-\(String(format: "%02d", c.month!))-\(String(format: "%02d", c.day!))"
}

/// Inclusive day count between `from` and `to` (both `YYYY-MM-DD`, UTC).
public func spanDays(_ from: String, _ to: String) -> Int {
    guard let (fy, fm, fd) = parseReportYmd(from), let (ty, tm, td) = parseReportYmd(to) else { return 0 }
    let a = makeReportDate(fy, fm, fd)
    let b = makeReportDate(ty, tm, td)
    let days = utcCalendarForReports.dateComponents([.day], from: a, to: b).day!
    return days + 1
}

/// Resolves a preset into a concrete `[from, to]` date range, anchored on `today`.
public func resolvePreset(_ preset: Preset, today: String, earliest: String?) -> (from: String, to: String) {
    switch preset {
    case .d7:
        return (addDaysUTC(today, -6), today)
    case .d30:
        return (addDaysUTC(today, -29), today)
    case .month:
        return (String(today.prefix(7)) + "-01", today)
    case .year:
        return (String(today.prefix(4)) + "-01-01", today)
    case .all:
        return (earliest ?? today, today)
    }
}

/// Default bucket granularity for a preset, before any user override or clamping.
public func defaultGranularity(_ preset: Preset) -> Granularity {
    switch preset {
    case .year, .all: return .month
    default: return .day
    }
}

/// Clamps a requested granularity down for very wide ranges, so the bucket
/// count stays reasonable. Applied sequentially: day→week, then week→month.
public func clampGranularity(_ g: Granularity, from: String, to: String) -> Granularity {
    let span = spanDays(from, to)
    var result = g
    if result == .day && span > 92 {
        result = .week
    }
    if result == .week && span > 1100 {
        result = .month
    }
    return result
}
