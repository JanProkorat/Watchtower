import Foundation

public let openEndedSentinel = "9999-12-31"

/// Ported from packages/shared/src/billing/contracts-overlap.ts
public func contractsOverlap(_ aFrom: String, _ aEnd: String?, _ bFrom: String, _ bEnd: String?) -> Bool {
    aFrom <= (bEnd ?? openEndedSentinel) && (aEnd ?? openEndedSentinel) >= bFrom
}

/// Ported from packages/shared/src/billing/date-helpers.ts — MUST use a UTC calendar.
public func previousDay(_ date: String) -> String {
    let parts = date.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3 else { return date }
    var utc = Calendar(identifier: .gregorian)
    utc.timeZone = TimeZone(identifier: "UTC")!
    var comps = DateComponents()
    comps.year = parts[0]; comps.month = parts[1]; comps.day = parts[2]
    guard let d = utc.date(from: comps),
          let prev = utc.date(byAdding: .day, value: -1, to: d) else { return date }
    let out = utc.dateComponents([.year, .month, .day], from: prev)
    return String(format: "%04d-%02d-%02d", out.year!, out.month!, out.day!)
}
