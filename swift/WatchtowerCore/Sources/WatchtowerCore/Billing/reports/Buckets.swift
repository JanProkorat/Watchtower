import Foundation

/// Report bucket granularity — mirrors `packages/shared/src/billing/reports/buckets.ts`.
public enum Granularity: String, CaseIterable, Sendable, Equatable {
    case day, week, month
}

// UTC calendar for all date-string arithmetic (never local zone).
private let utcCal: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "UTC")!
    return c
}()

private func parseYmd(_ date: String) -> (y: Int, m: Int, d: Int)? {
    let parts = date.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3 else { return nil }
    return (parts[0], parts[1], parts[2])
}

private func makeDate(_ y: Int, _ m: Int, _ d: Int) -> Date {
    utcCal.date(from: DateComponents(year: y, month: m, day: d))!
}

private func addDay(_ date: String) -> String {
    guard let (y, m, d) = parseYmd(date) else { return date }
    let dt = utcCal.date(byAdding: .day, value: 1, to: makeDate(y, m, d))!
    let c = utcCal.dateComponents([.year, .month, .day], from: dt)
    return "\(c.year!)-\(String(format: "%02d", c.month!))-\(String(format: "%02d", c.day!))"
}

/// Bucket key for `date` at `granularity`. Week key mirrors SQLite
/// `strftime('%Y-W%W')` — Monday-first, week 00 before the first Monday.
public func bucketKey(_ date: String, _ granularity: Granularity) -> String {
    switch granularity {
    case .day:
        return date
    case .month:
        return String(date.prefix(7))
    case .week:
        guard let (y, m, d) = parseYmd(date) else { return date }
        let dt = makeDate(y, m, d)
        let jan1 = makeDate(y, 1, 1)
        let yday = utcCal.dateComponents([.day], from: jan1, to: dt).day! // 0-based day of year
        let weekday = utcCal.component(.weekday, from: dt) // Sunday=1 ... Saturday=7
        let daysSinceMonday = (weekday + 5) % 7 // Mon=0 .. Sun=6
        // Numerator is always >= 1 here, so truncating integer division equals floor.
        let week = (yday - daysSinceMonday + 7) / 7
        return "\(y)-W\(String(format: "%02d", week))"
    }
}

/// Enumerates distinct bucket keys for every day in `[from, to]` (inclusive),
/// preserving first-seen order.
public func enumerateBuckets(_ from: String, _ to: String, _ granularity: Granularity) -> [String] {
    var out: [String] = []
    var seen = Set<String>()
    var cursor = from
    while cursor <= to {
        let key = bucketKey(cursor, granularity)
        if !seen.contains(key) {
            seen.insert(key)
            out.append(key)
        }
        cursor = addDay(cursor)
    }
    return out
}
