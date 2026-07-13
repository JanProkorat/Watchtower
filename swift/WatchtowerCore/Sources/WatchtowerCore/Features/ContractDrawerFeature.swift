import Foundation
import ComposableArchitecture

/// Create/edit/delete a per-project contract (rate history entry), mirroring
/// `WorklogFormFeature`'s optimistic-write/rollback template — but this is the
/// most intricate editor in Milestone 3, porting
/// `packages/data-supabase/src/useContractMutations.ts` (`createContractCore`,
/// `updateContractCore`, `deleteContractCore`) verbatim:
///
/// - **Solo** create/update/delete: exactly one project, no `contractGroupId`.
/// - **Shared-group** create/update/delete: several projects share one
///   `contractGroupId` — all sibling rows carry identical terms.
/// - A create always **prechecks** first: any conflicting overlap on a target
///   project aborts BEFORE any optimistic patch or write (solo: abort with an
///   error; group: ANY single member conflicting aborts the WHOLE group —
///   never a partial group write).
/// - A create also auto-closes a prior open-ended contract that starts before
///   the new one, by end-dating it to `previousDay(newEffectiveFrom)` — this
///   closing is itself excluded from the overlap check (the projection used
///   for the conflict check has the prior already closed).
/// - An update on a grouped row reconciles group membership: members dropped
///   from `sharedProjectIds` are soft-deleted, retained members are updated,
///   newly added members go through the same create-precheck as a fresh
///   member — again, ALL prechecked before ANY write.
/// - Every mutation ends by cache-rebilling (`rebillProjectWorklogs`) every
///   affected project's worklogs, since a contract's rate directly recomputes
///   `effectiveMinutes`/`earnedAmount` for that project's rows.
@Reducer
public struct ContractDrawerFeature {
    @ObservableState
    public struct State: Equatable, Identifiable {
        public enum Mode: Equatable {
            case create(projectId: Int)
            case edit(ContractRow)
        }

        public let id: String
        public var mode: Mode
        public var effectiveFromText: String
        public var endDateText: String
        public var rateType: String
        public var rateAmountText: String
        public var hoursPerDayText: String
        public var mdLimitText: String
        /// Other project ids this contract is (or should become) shared with —
        /// NEVER includes the mode's own project id. Empty means solo.
        ///
        /// For `.edit` of an already-grouped contract, the parent view is
        /// expected to prefill this from the group's current membership
        /// (mirroring the desktop `ContractDrawer.tsx`'s `draftOf()`, which
        /// always seeds `sharedProjectIds` from `contract.projectIds` minus
        /// the current project) BEFORE the user touches anything — this
        /// reducer treats whatever is in the set as the fully-desired target
        /// membership, not a diff to apply.
        public var sharedProjectIds: Set<Int>
        public var isSaving: Bool
        public var errorMessage: String?

        @Shared(.inMemory("billingDataset")) public var dataset: BillingDataset? = nil
        @Shared(.inMemory("billingLoadState")) public var loadState: BillingFeature.LoadState = .loading

        public init(
            mode: Mode,
            effectiveFromText: String? = nil,
            endDateText: String? = nil,
            rateType: String? = nil,
            rateAmountText: String? = nil,
            hoursPerDayText: String? = nil,
            mdLimitText: String? = nil,
            sharedProjectIds: Set<Int> = [],
            isSaving: Bool = false,
            errorMessage: String? = nil
        ) {
            self.mode = mode
            switch mode {
            case .create:
                self.id = UUID().uuidString
                self.effectiveFromText = effectiveFromText ?? ""
                self.endDateText = endDateText ?? ""
                self.rateType = rateType ?? "hourly"
                self.rateAmountText = rateAmountText ?? ""
                self.hoursPerDayText = hoursPerDayText ?? "8"
                self.mdLimitText = mdLimitText ?? ""
            case let .edit(row):
                self.id = row.syncId
                self.effectiveFromText = effectiveFromText ?? row.effectiveFrom
                self.endDateText = endDateText ?? (row.endDate ?? "")
                self.rateType = rateType ?? row.rateType
                self.rateAmountText = rateAmountText ?? Self.formatNumber(row.rateAmount)
                self.hoursPerDayText = hoursPerDayText ?? Self.formatNumber(row.hoursPerDay)
                self.mdLimitText = mdLimitText ?? (row.mdLimit.map(Self.formatNumber) ?? "")
            }
            self.sharedProjectIds = sharedProjectIds
            self.isSaving = isSaving
            self.errorMessage = errorMessage
        }

        private static func formatNumber(_ value: Double) -> String {
            value == value.rounded() ? String(Int(value)) : String(value)
        }
    }

    /// Reuses `WorklogFormFeature`'s error type — every Milestone-3 editor's
    /// write effect fails the same way (a thrown error from the
    /// `BillingWriteClient` closure).
    public typealias BillingWriteError = WorklogFormFeature.BillingWriteError

    public enum Action: BindableAction {
        case binding(BindingAction<State>)
        case saveTapped
        case deleteTapped
        case writeFinished(Result<Void, BillingWriteError>)
        case delegate(Delegate)

        public enum Delegate: Equatable {
            case dismissed
        }
    }

    @Dependency(\.billingWriteClient) var billingWriteClient
    @Dependency(\.date.now) var now
    @Dependency(\.uuid) var uuid

    public init() {}

    private static let isoFormatter = ISO8601DateFormatter()

    public var body: some ReducerOf<Self> {
        BindingReducer()
        Reduce { state, action in
            switch action {
            case .binding:
                return .none

            case .saveTapped:
                return save(&state)

            case .deleteTapped:
                return delete(&state)

            case .writeFinished(.success):
                state.isSaving = false
                return .send(.delegate(.dismissed))

            case .writeFinished(.failure):
                state.isSaving = false
                state.errorMessage = "Save failed. Please try again."
                return .none

            case .delegate:
                return .none
            }
        }
    }

    // MARK: - Save (create or edit) — validation + dispatch

    private func save(_ state: inout State) -> Effect<Action> {
        guard canEdit(state.loadState) else {
            state.errorMessage = "Not editable while offline"
            return .none
        }
        guard let dataset = state.dataset else {
            state.errorMessage = "Not editable while offline"
            return .none
        }

        let trimmedFrom = state.effectiveFromText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedFrom.isEmpty else {
            state.errorMessage = "Enter an effective-from date"
            return .none
        }
        let trimmedEnd = state.endDateText.trimmingCharacters(in: .whitespacesAndNewlines)
        let endDate = trimmedEnd.isEmpty ? nil : trimmedEnd

        guard let rateAmount = Double(state.rateAmountText.trimmingCharacters(in: .whitespacesAndNewlines)), rateAmount >= 0 else {
            state.errorMessage = "Enter a valid rate amount"
            return .none
        }
        guard let hoursPerDay = Double(state.hoursPerDayText.trimmingCharacters(in: .whitespacesAndNewlines)), hoursPerDay > 0 else {
            state.errorMessage = "Enter valid hours per day"
            return .none
        }
        let trimmedMdLimit = state.mdLimitText.trimmingCharacters(in: .whitespacesAndNewlines)
        let mdLimit: Double?
        if trimmedMdLimit.isEmpty {
            mdLimit = nil
        } else if let parsed = Double(trimmedMdLimit), parsed >= 0 {
            mdLimit = parsed
        } else {
            state.errorMessage = "Enter a valid MD limit"
            return .none
        }

        let input = ContractWriteInput(
            effectiveFrom: trimmedFrom, endDate: endDate, rateType: state.rateType,
            rateAmount: rateAmount, hoursPerDay: hoursPerDay, mdLimit: mdLimit
        )
        let nowString = Self.isoFormatter.string(from: now)
        let previousDataset = state.dataset

        switch state.mode {
        case let .create(projectId):
            let targets = Self.resolveTargets(projectId: projectId, sharedProjectIds: state.sharedProjectIds)
            if targets.count <= 1 {
                return saveCreateSolo(&state, dataset: dataset, projectId: projectId, input: input, nowString: nowString, previousDataset: previousDataset)
            } else {
                return saveCreateGroup(&state, dataset: dataset, targets: targets, input: input, nowString: nowString, previousDataset: previousDataset)
            }

        case let .edit(existing):
            if existing.contractGroupId == nil {
                return saveEditSolo(&state, dataset: dataset, existing: existing, input: input, nowString: nowString, previousDataset: previousDataset)
            } else {
                return saveEditGroup(&state, dataset: dataset, existing: existing, groupId: existing.contractGroupId!, input: input, nowString: nowString, previousDataset: previousDataset)
            }
        }
    }

    // MARK: - Create — solo

    private func saveCreateSolo(
        _ state: inout State, dataset: BillingDataset, projectId: Int, input: ContractWriteInput,
        nowString: String, previousDataset: BillingDataset?
    ) -> Effect<Action> {
        let precheck = Self.precheckCreate(dataset.contracts, projectId: projectId, input: input)
        if let conflict = precheck.conflict {
            state.errorMessage = Self.overlapMessage(conflict)
            return .none
        }
        state.errorMessage = nil

        let syncId = uuid().uuidString
        var nextContracts = dataset.contracts
        if let closedPrior = precheck.closedPrior {
            nextContracts = Self.applyContractWrite(nextContracts, upsert: closedPrior)
        }
        nextContracts = Self.applyContractWrite(nextContracts, upsert: Self.buildOptimisticContractRow(input, projectId: projectId, syncId: syncId, groupId: nil))

        state.$dataset.withLock { current in
            guard let value = current else { return }
            let rebilled = rebillProjectWorklogs(value.worklogs, projectId: projectId, contracts: nextContracts)
            current = value.replacing(worklogs: rebilled, contracts: nextContracts)
        }
        state.isSaving = true

        let prior = precheck.prior
        let sharedDataset = state.$dataset
        let client = billingWriteClient
        return .run { send in
            do {
                if let prior {
                    try await client.updateContractEndDate(prior.syncId, buildContractEndDate(endDate: previousDay(input.effectiveFrom), now: nowString))
                }
                try await client.insertContracts([buildContractInsert(input: input, projectId: projectId, syncId: syncId, now: nowString, groupId: nil)])
                await send(.writeFinished(.success(())))
            } catch {
                sharedDataset.withLock { $0 = previousDataset }
                await send(.writeFinished(.failure(.writeFailed)))
            }
        }
    }

    // MARK: - Create — shared group

    private struct CreatePlan: Sendable {
        let projectId: Int
        let input: ContractWriteInput
        let prior: ContractRow?
        let closedPrior: ContractRow?
        let syncId: String
    }

    private func saveCreateGroup(
        _ state: inout State, dataset: BillingDataset, targets: [Int], input: ContractWriteInput,
        nowString: String, previousDataset: BillingDataset?
    ) -> Effect<Action> {
        // Precheck EVERY member against the PRISTINE cache first — any single
        // conflict aborts the whole group before anything is patched/written.
        var plans: [CreatePlan] = []
        for projectId in targets {
            let precheck = Self.precheckCreate(dataset.contracts, projectId: projectId, input: input)
            if let conflict = precheck.conflict {
                state.errorMessage = Self.overlapMessage(conflict, projectId: projectId)
                return .none
            }
            plans.append(CreatePlan(projectId: projectId, input: input, prior: precheck.prior, closedPrior: precheck.closedPrior, syncId: uuid().uuidString))
        }
        state.errorMessage = nil

        let groupId = uuid().uuidString
        var nextContracts = dataset.contracts
        for plan in plans {
            if let closedPrior = plan.closedPrior {
                nextContracts = Self.applyContractWrite(nextContracts, upsert: closedPrior)
            }
            nextContracts = Self.applyContractWrite(nextContracts, upsert: Self.buildOptimisticContractRow(plan.input, projectId: plan.projectId, syncId: plan.syncId, groupId: groupId))
        }

        state.$dataset.withLock { current in
            guard let value = current else { return }
            var nextWorklogs = value.worklogs
            for projectId in targets { nextWorklogs = rebillProjectWorklogs(nextWorklogs, projectId: projectId, contracts: nextContracts) }
            current = value.replacing(worklogs: nextWorklogs, contracts: nextContracts)
        }
        state.isSaving = true

        let finalPlans = plans
        let sharedDataset = state.$dataset
        let client = billingWriteClient
        return .run { send in
            do {
                for plan in finalPlans {
                    if let prior = plan.prior {
                        try await client.updateContractEndDate(prior.syncId, buildContractEndDate(endDate: previousDay(plan.input.effectiveFrom), now: nowString))
                    }
                }
                let rows = finalPlans.map { buildContractInsert(input: $0.input, projectId: $0.projectId, syncId: $0.syncId, now: nowString, groupId: groupId) }
                try await client.insertContracts(rows)
                await send(.writeFinished(.success(())))
            } catch {
                sharedDataset.withLock { $0 = previousDataset }
                await send(.writeFinished(.failure(.writeFailed)))
            }
        }
    }

    // MARK: - Update — solo

    private func saveEditSolo(
        _ state: inout State, dataset: BillingDataset, existing: ContractRow, input: ContractWriteInput,
        nowString: String, previousDataset: BillingDataset?
    ) -> Effect<Action> {
        if let conflict = Self.findOverlap(dataset.contracts, projectId: existing.projectId, input: input, excludeSyncId: existing.syncId) {
            state.errorMessage = Self.overlapMessage(conflict)
            return .none
        }
        state.errorMessage = nil

        let updatedRow = Self.buildOptimisticContractRow(input, projectId: existing.projectId, syncId: existing.syncId, groupId: nil)
        let nextContracts = Self.applyContractWrite(dataset.contracts, upsert: updatedRow)

        state.$dataset.withLock { current in
            guard let value = current else { return }
            let rebilled = rebillProjectWorklogs(value.worklogs, projectId: existing.projectId, contracts: nextContracts)
            current = value.replacing(worklogs: rebilled, contracts: nextContracts)
        }
        state.isSaving = true

        let sharedDataset = state.$dataset
        let client = billingWriteClient
        return .run { send in
            do {
                try await client.updateContract(existing.syncId, buildContractUpdate(input: input, now: nowString))
                await send(.writeFinished(.success(())))
            } catch {
                sharedDataset.withLock { $0 = previousDataset }
                await send(.writeFinished(.failure(.writeFailed)))
            }
        }
    }

    // MARK: - Update — shared group (membership reconciliation)

    private enum UpdatePlan: Sendable {
        case update(row: ContractRow, input: ContractWriteInput)
        case insert(input: ContractWriteInput, projectId: Int, prior: ContractRow?, closedPrior: ContractRow?, syncId: String)
    }

    private func saveEditGroup(
        _ state: inout State, dataset: BillingDataset, existing: ContractRow, groupId: String, input: ContractWriteInput,
        nowString: String, previousDataset: BillingDataset?
    ) -> Effect<Action> {
        let currentMembers = dataset.contracts.filter { $0.contractGroupId == groupId }
        let currentProjectIds = currentMembers.map(\.projectId)
        let targetList = Self.resolveTargets(projectId: existing.projectId, sharedProjectIds: state.sharedProjectIds)

        var plans: [UpdatePlan] = []
        for projectId in targetList {
            if let member = currentMembers.first(where: { $0.projectId == projectId }) {
                if let conflict = Self.findOverlap(dataset.contracts, projectId: projectId, input: input, excludeSyncId: member.syncId) {
                    state.errorMessage = Self.overlapMessage(conflict, projectId: projectId)
                    return .none
                }
                plans.append(.update(row: member, input: input))
            } else {
                let precheck = Self.precheckCreate(dataset.contracts, projectId: projectId, input: input)
                if let conflict = precheck.conflict {
                    state.errorMessage = Self.overlapMessage(conflict, projectId: projectId)
                    return .none
                }
                plans.append(.insert(input: input, projectId: projectId, prior: precheck.prior, closedPrior: precheck.closedPrior, syncId: uuid().uuidString))
            }
        }
        state.errorMessage = nil

        let removed = currentMembers.filter { !targetList.contains($0.projectId) }

        var nextContracts = dataset.contracts
        for member in removed {
            nextContracts = Self.applyContractWrite(nextContracts, remove: member.syncId)
        }
        for plan in plans {
            switch plan {
            case let .update(row, planInput):
                let updated = ContractRow(
                    syncId: row.syncId, projectId: row.projectId, effectiveFrom: planInput.effectiveFrom,
                    endDate: planInput.endDate, rateType: planInput.rateType, rateAmount: planInput.rateAmount,
                    hoursPerDay: planInput.hoursPerDay, mdLimit: planInput.mdLimit, contractGroupId: row.contractGroupId
                )
                nextContracts = Self.applyContractWrite(nextContracts, upsert: updated)
            case let .insert(planInput, projectId, _, closedPrior, syncId):
                if let closedPrior {
                    nextContracts = Self.applyContractWrite(nextContracts, upsert: closedPrior)
                }
                nextContracts = Self.applyContractWrite(nextContracts, upsert: Self.buildOptimisticContractRow(planInput, projectId: projectId, syncId: syncId, groupId: groupId))
            }
        }

        // Rebill every project that was, or now is, a member — a dropped
        // member's worklogs need re-derivation too (it just lost its contract).
        let affected = Array(Set(currentProjectIds + targetList))
        state.$dataset.withLock { current in
            guard let value = current else { return }
            var nextWorklogs = value.worklogs
            for projectId in affected { nextWorklogs = rebillProjectWorklogs(nextWorklogs, projectId: projectId, contracts: nextContracts) }
            current = value.replacing(worklogs: nextWorklogs, contracts: nextContracts)
        }
        state.isSaving = true

        let finalPlans = plans
        let sharedDataset = state.$dataset
        let client = billingWriteClient
        return .run { send in
            do {
                for member in removed {
                    try await client.deleteContract(member.syncId, softDelete(now: nowString))
                }
                for plan in finalPlans {
                    switch plan {
                    case let .update(row, planInput):
                        try await client.updateContract(row.syncId, buildContractUpdate(input: planInput, now: nowString))
                    case let .insert(planInput, projectId, prior, _, syncId):
                        if let prior {
                            try await client.updateContractEndDate(prior.syncId, buildContractEndDate(endDate: previousDay(planInput.effectiveFrom), now: nowString))
                        }
                        try await client.insertContracts([buildContractInsert(input: planInput, projectId: projectId, syncId: syncId, now: nowString, groupId: groupId)])
                    }
                }
                await send(.writeFinished(.success(())))
            } catch {
                sharedDataset.withLock { $0 = previousDataset }
                await send(.writeFinished(.failure(.writeFailed)))
            }
        }
    }

    // MARK: - Delete (edit mode only)

    private func delete(_ state: inout State) -> Effect<Action> {
        guard case let .edit(existing) = state.mode else { return .none }
        guard canEdit(state.loadState) else {
            state.errorMessage = "Not editable while offline"
            return .none
        }
        guard let dataset = state.dataset else {
            state.errorMessage = "Not editable while offline"
            return .none
        }

        let nowString = Self.isoFormatter.string(from: now)
        let previousDataset = state.dataset

        guard let groupId = existing.contractGroupId else {
            let nextContracts = Self.applyContractWrite(dataset.contracts, remove: existing.syncId)
            state.$dataset.withLock { current in
                guard let value = current else { return }
                let rebilled = rebillProjectWorklogs(value.worklogs, projectId: existing.projectId, contracts: nextContracts)
                current = value.replacing(worklogs: rebilled, contracts: nextContracts)
            }
            state.isSaving = true
            state.errorMessage = nil

            let sharedDataset = state.$dataset
            let client = billingWriteClient
            return .run { send in
                do {
                    try await client.deleteContract(existing.syncId, softDelete(now: nowString))
                    await send(.writeFinished(.success(())))
                } catch {
                    sharedDataset.withLock { $0 = previousDataset }
                    await send(.writeFinished(.failure(.writeFailed)))
                }
            }
        }

        let members = dataset.contracts.filter { $0.contractGroupId == groupId }
        let nextContracts = dataset.contracts.filter { $0.contractGroupId != groupId }
        state.$dataset.withLock { current in
            guard let value = current else { return }
            var nextWorklogs = value.worklogs
            for member in members { nextWorklogs = rebillProjectWorklogs(nextWorklogs, projectId: member.projectId, contracts: nextContracts) }
            current = value.replacing(worklogs: nextWorklogs, contracts: nextContracts)
        }
        state.isSaving = true
        state.errorMessage = nil

        let sharedDataset = state.$dataset
        let client = billingWriteClient
        return .run { send in
            do {
                try await client.deleteContractGroup(groupId, softDelete(now: nowString))
                await send(.writeFinished(.success(())))
            } catch {
                sharedDataset.withLock { $0 = previousDataset }
                await send(.writeFinished(.failure(.writeFailed)))
            }
        }
    }

    // MARK: - Pure helpers (ported from useContractMutations.ts)

    /// `[projectId] + sorted(sharedProjectIds minus projectId)` — deterministic
    /// member ordering so effect assertions (insert order, mint order) are stable.
    private static func resolveTargets(projectId: Int, sharedProjectIds: Set<Int>) -> [Int] {
        [projectId] + sharedProjectIds.subtracting([projectId]).sorted()
    }

    /// First overlapping contract on the same project (excluding `excludeSyncId`), or nil.
    private static func findOverlap(_ contracts: [ContractRow], projectId: Int, input: ContractWriteInput, excludeSyncId: String?) -> ContractRow? {
        contracts.first {
            $0.projectId == projectId && $0.syncId != excludeSyncId && contractsOverlap($0.effectiveFrom, $0.endDate, input.effectiveFrom, input.endDate)
        }
    }

    /// Create-like precheck for one project: auto-close a prior open-ended
    /// contract starting earlier, then overlap-check against the projection
    /// with that prior already closed (so the prior being closed doesn't
    /// false-trip the check).
    private static func precheckCreate(_ contracts: [ContractRow], projectId: Int, input: ContractWriteInput) -> (prior: ContractRow?, closedPrior: ContractRow?, conflict: ContractRow?) {
        let prior = contracts.first { $0.projectId == projectId && $0.endDate == nil && $0.effectiveFrom < input.effectiveFrom }
        let closedPrior: ContractRow? = prior.map { p in
            ContractRow(
                syncId: p.syncId, projectId: p.projectId, effectiveFrom: p.effectiveFrom,
                endDate: previousDay(input.effectiveFrom), rateType: p.rateType, rateAmount: p.rateAmount,
                hoursPerDay: p.hoursPerDay, mdLimit: p.mdLimit, contractGroupId: p.contractGroupId
            )
        }
        let projected: [ContractRow]
        if let prior, let closedPrior {
            projected = contracts.map { $0.syncId == prior.syncId ? closedPrior : $0 }
        } else {
            projected = contracts
        }
        let conflict = projected.first { $0.projectId == projectId && contractsOverlap($0.effectiveFrom, $0.endDate, input.effectiveFrom, input.endDate) }
        return (prior, closedPrior, conflict)
    }

    private static func buildOptimisticContractRow(_ input: ContractWriteInput, projectId: Int, syncId: String, groupId: String?) -> ContractRow {
        ContractRow(
            syncId: syncId, projectId: projectId, effectiveFrom: input.effectiveFrom, endDate: input.endDate,
            rateType: input.rateType, rateAmount: input.rateAmount, hoursPerDay: input.hoursPerDay,
            mdLimit: input.mdLimit, contractGroupId: groupId
        )
    }

    private static func applyContractWrite(_ contracts: [ContractRow], upsert row: ContractRow) -> [ContractRow] {
        contracts.filter { $0.syncId != row.syncId } + [row]
    }

    private static func applyContractWrite(_ contracts: [ContractRow], remove syncId: String) -> [ContractRow] {
        contracts.filter { $0.syncId != syncId }
    }

    private static func overlapMessage(_ conflict: ContractRow, projectId: Int? = nil) -> String {
        let range = "from \(conflict.effectiveFrom)" + (conflict.endDate.map { " to \($0)" } ?? "")
        let base = "Rate overlaps with an existing contract \(range)"
        guard let projectId else { return base }
        return "Project #\(projectId): \(base)"
    }
}
