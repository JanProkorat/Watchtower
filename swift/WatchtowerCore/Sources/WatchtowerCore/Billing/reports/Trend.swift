import Foundation

/// Per-bucket trend point — mirrors `packages/shared/src/billing/reports/trend.ts`.
public struct TrendBucket: Equatable, Sendable {
    public let bucket: String
    public let minutes: Double
    public let earnedCzk: Double

    public init(bucket: String, minutes: Double, earnedCzk: Double) {
        self.bucket = bucket
        self.minutes = minutes
        self.earnedCzk = earnedCzk
    }
}

/// A contract effective-date change worth marking on a trend chart.
public struct RateMarker: Equatable, Sendable {
    public let effectiveFrom: String
    public let rateType: String
    public let rateAmount: Double

    public init(effectiveFrom: String, rateType: String, rateAmount: Double) {
        self.effectiveFrom = effectiveFrom
        self.rateType = rateType
        self.rateAmount = rateAmount
    }
}

/// Buckets `rows` by `granularity` within `[from, to]`, optionally scoped to
/// `projectId`. Sums `effectiveMinutes` always; sums `earnedAmount` only for
/// rows where it is non-nil. Result is sorted ascending by bucket key.
public func trendSeries(
    _ rows: [WorklogRow], from: String, to: String, granularity: Granularity, projectId: Int?
) -> [TrendBucket] {
    var buckets: [String: TrendBucket] = [:]
    for r in rows {
        if r.workDate < from || r.workDate > to { continue }
        if let projectId, r.projectId != projectId { continue }
        let key = bucketKey(r.workDate, granularity)
        let cur = buckets[key] ?? TrendBucket(bucket: key, minutes: 0, earnedCzk: 0)
        let earned = cur.earnedCzk + (r.earnedAmount ?? 0)
        buckets[key] = TrendBucket(bucket: key, minutes: cur.minutes + r.effectiveMinutes, earnedCzk: earned)
    }
    return buckets.values.sorted { $0.bucket < $1.bucket }
}

/// Rate-change markers for `projectId`'s contracts within `[from, to]`. The
/// earliest contract (by `effectiveFrom`) is dropped — it's the starting
/// rate, not a "change". Returns `[]` when `projectId` is nil.
public func rateChangeMarkers(
    _ contracts: [ContractRow], from: String, to: String, projectId: Int?
) -> [RateMarker] {
    guard let projectId else { return [] }
    let ordered = contracts
        .filter { $0.projectId == projectId }
        .sorted { $0.effectiveFrom < $1.effectiveFrom }
    return ordered
        .dropFirst()
        .filter { $0.effectiveFrom >= from && $0.effectiveFrom <= to }
        .map { RateMarker(effectiveFrom: $0.effectiveFrom, rateType: $0.rateType, rateAmount: $0.rateAmount) }
}
