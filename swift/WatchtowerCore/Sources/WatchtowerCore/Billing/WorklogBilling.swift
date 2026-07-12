import Foundation

public struct ContractLite: Equatable, Sendable {
    public let effectiveFrom: String
    public let rateType: String
    public let rateAmount: Double
    public let hoursPerDay: Double
    public init(effectiveFrom: String, rateType: String, rateAmount: Double, hoursPerDay: Double) {
        self.effectiveFrom = effectiveFrom; self.rateType = rateType
        self.rateAmount = rateAmount; self.hoursPerDay = hoursPerDay
    }
}

public struct WorklogBilling: Equatable, Sendable {
    public let effectiveMinutes: Double
    public let resolvedRate: Double?
    public let earnedAmount: Double?
}

/// Latest effectiveFrom <= workDate, lexicographic string compare (timezone-safe).
/// Tie on equal effectiveFrom: first encountered in array order wins (strict `>`).
public func resolveContract(workDate: String, contracts: [ContractLite]) -> ContractLite? {
    var best: ContractLite?
    for c in contracts where c.effectiveFrom <= workDate {
        if best == nil || c.effectiveFrom > best!.effectiveFrom { best = c }
    }
    return best
}

public func computeWorklogBilling(minutes: Double, reportedMinutes: Double?, workDate: String, contracts: [ContractLite]) -> WorklogBilling {
    let effectiveMinutes = reportedMinutes ?? minutes
    guard let c = resolveContract(workDate: workDate, contracts: contracts) else {
        return WorklogBilling(effectiveMinutes: effectiveMinutes, resolvedRate: nil, earnedAmount: nil)
    }
    let earned = c.rateType == "hourly"
        ? (effectiveMinutes * c.rateAmount) / 60.0
        : (effectiveMinutes / 60.0 / c.hoursPerDay) * c.rateAmount
    return WorklogBilling(effectiveMinutes: effectiveMinutes, resolvedRate: c.rateAmount, earnedAmount: earned)
}
