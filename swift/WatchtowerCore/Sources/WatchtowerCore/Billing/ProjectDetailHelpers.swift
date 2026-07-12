import Foundation

// Pure helpers for ProjectDetailView — rate-window assignment and earnings rollup.
// Ported from packages/ui-core/src/projectDetailHelpers.ts.

/// Given a worklog's workDate and a list of contracts for that project, returns the
/// contract whose window covers workDate: the one with the latest `effectiveFrom`
/// that is still <= workDate. Mirrors `resolveContract` in WorklogBilling.swift
/// (same latest-effectiveFrom<=date rule, first-encountered wins on a tie).
public func assignWorklogToContract(workDate: String, contracts: [ContractRow]) -> ContractRow? {
    var best: ContractRow?
    for c in contracts where c.effectiveFrom <= workDate {
        if best == nil || c.effectiveFrom > best!.effectiveFrom { best = c }
    }
    return best
}

/// The contract whose window contains `today`.
public func activeContract(_ contracts: [ContractRow], today: String) -> ContractRow? {
    assignWorklogToContract(workDate: today, contracts: contracts)
}

/// Formats a contract's rate as a Czech string, e.g. hourly 1500 CZK -> "1 500 Kč/h",
/// daily 8000 CZK -> "8 000 Kč/MD". Reuses `CzFormat.czk` for the NBSP-grouped amount.
public func rateLabel(_ contract: ContractRow) -> String {
    let unit = contract.rateType == "hourly" ? "/h" : "/MD"
    return "\(CzFormat.czk(contract.rateAmount))\(unit)"
}

/// One entry per contract in the project's history, with summed CZK earned by
/// worklogs assigned to that contract's window.
public struct ContractEarning: Equatable {
    public let contract: ContractRow
    public let earnedCzk: Double

    public init(contract: ContractRow, earnedCzk: Double) {
        self.contract = contract
        self.earnedCzk = earnedCzk
    }
}

public func rollupEarningsByContract(worklogs: [WorklogRow], contracts: [ContractRow]) -> [ContractEarning] {
    // Sort contracts by effectiveFrom desc (most recent first — for display).
    let sorted = contracts.sorted { $0.effectiveFrom > $1.effectiveFrom }

    return sorted.map { contract in
        // Sum CZK earnedAmount from worklogs assigned to this contract.
        // All earnings are CZK — currency field was removed in #108.
        var earnedCzk = 0.0
        for wl in worklogs {
            guard let amount = wl.earnedAmount else { continue }
            guard let assigned = assignWorklogToContract(workDate: wl.workDate, contracts: contracts) else { continue }
            if assigned == contract {
                earnedCzk += amount
            }
        }
        return ContractEarning(contract: contract, earnedCzk: earnedCzk)
    }
}

/// Count of distinct projectIds sharing a contract group (a "shared contract" spans
/// multiple projects, one ContractRow per project, linked by `contractGroupId`).
public func sharedMemberCount(_ contracts: [ContractRow], groupId: String) -> Int {
    var ids = Set<Int>()
    for c in contracts where c.contractGroupId == groupId {
        ids.insert(c.projectId)
    }
    return ids.count
}
