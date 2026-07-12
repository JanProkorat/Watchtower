import Foundation
import ComposableArchitecture

/// Create/edit/delete a single worklog, with client-derived billing and an
/// optimistic in-place patch of the shared `billingDataset`/`billingLoadState`
/// (the same storage `BillingFeature` owns, via `@Shared(.inMemory(...))`).
///
/// This is the FIRST editor feature and the template the other Milestone-3
/// editors (task/contract/day-off) copy: every mutation follows the same
/// shape —
///   1. validate synchronously (parse input, `canEdit` gate);
///   2. snapshot the current shared dataset;
///   3. patch the shared dataset in place, synchronously, inside the
///      reducer (optimistic update — the UI reflects it immediately);
///   4. fire the write effect, capturing the `Shared` dataset box (not
///      `state` itself, which can't cross the effect boundary) so a
///      failure can roll the snapshot back directly from inside the effect;
///   5. `writeFinished` flips `isSaving`/`errorMessage` — plain `State`
///      fields that DO need `inout state`, hence routed through an action.
@Reducer
public struct WorklogFormFeature {
    @ObservableState
    public struct State: Equatable, Identifiable {
        public enum Mode: Equatable {
            case create(task: TaskRow, date: String)
            case edit(WorklogRow)
        }

        public let id: String
        public var mode: Mode
        public var hoursText: String
        public var descriptionText: String
        public var isSaving: Bool
        public var errorMessage: String?

        @Shared(.inMemory("billingDataset")) public var dataset: BillingDataset? = nil
        @Shared(.inMemory("billingLoadState")) public var loadState: BillingFeature.LoadState = .loading

        public init(
            mode: Mode,
            hoursText: String? = nil,
            descriptionText: String? = nil,
            isSaving: Bool = false,
            errorMessage: String? = nil
        ) {
            self.mode = mode
            switch mode {
            case .create:
                self.id = UUID().uuidString
                self.hoursText = hoursText ?? ""
                self.descriptionText = descriptionText ?? ""
            case let .edit(row):
                self.id = row.syncId
                self.hoursText = hoursText ?? Self.formatHoursText(minutes: row.minutes)
                self.descriptionText = descriptionText ?? (row.description ?? "")
            }
            self.isSaving = isSaving
            self.errorMessage = errorMessage
        }

        private static func formatHoursText(minutes: Double) -> String {
            let total = Int(minutes.rounded())
            return String(format: "%d:%02d", total / 60, total % 60)
        }
    }

    public enum BillingWriteError: Error, Equatable {
        case writeFailed
    }

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

    // MARK: - Save (create or edit)

    private func save(_ state: inout State) -> Effect<Action> {
        guard let minutes = parseMinutes(state.hoursText) else {
            state.errorMessage = "Enter a valid duration"
            return .none
        }
        guard canEdit(state.loadState) else {
            state.errorMessage = "Not editable while offline"
            return .none
        }
        guard let dataset = state.dataset else {
            state.errorMessage = "Not editable while offline"
            return .none
        }

        let trimmedDescription = state.descriptionText.trimmingCharacters(in: .whitespacesAndNewlines)
        let description = trimmedDescription.isEmpty ? nil : trimmedDescription
        let minutesValue = Double(minutes)
        let nowString = Self.isoFormatter.string(from: now)

        // Snapshot BEFORE the optimistic patch, so a failed write can be
        // rolled back to exactly this value.
        let previousDataset = state.dataset

        switch state.mode {
        case let .create(task, date):
            let syncId = uuid().uuidString
            let input = WorklogWriteInput(workDate: date, minutes: minutesValue, reportedMinutes: nil, description: description)
            let billing = computeDerivedForWrite(
                contracts: dataset.contracts, projectId: task.projectId,
                minutes: input.minutes, reportedMinutes: input.reportedMinutes, workDate: date
            )
            let optimisticRow = WorklogRow(
                syncId: syncId, workDate: date, minutes: input.minutes, reportedMinutes: nil,
                effectiveMinutes: billing.effectiveMinutes, earnedAmount: billing.earnedAmount,
                description: description, projectId: task.projectId, projectName: task.projectName,
                projectColor: task.projectColor, projectKind: task.projectKind, isBillable: task.isBillable,
                taskNumber: task.taskNumber, taskTitle: task.taskTitle, source: "manual"
            )

            state.$dataset.withLock { current in
                guard let value = current else { return }
                current = value.replacing(worklogs: value.worklogs + [optimisticRow])
            }
            state.isSaving = true
            state.errorMessage = nil

            let payload = buildWorklogInsert(taskId: task.taskId, input: input, syncId: syncId, now: nowString, billing: billing)
            let sharedDataset = state.$dataset
            let client = billingWriteClient
            return .run { send in
                do {
                    try await client.insertWorklog(payload)
                    await send(.writeFinished(.success(())))
                } catch {
                    sharedDataset.withLock { $0 = previousDataset }
                    await send(.writeFinished(.failure(.writeFailed)))
                }
            }

        case let .edit(row):
            let input = WorklogWriteInput(workDate: row.workDate, minutes: minutesValue, reportedMinutes: row.reportedMinutes, description: description)
            let billing = computeDerivedForWrite(
                contracts: dataset.contracts, projectId: row.projectId,
                minutes: input.minutes, reportedMinutes: input.reportedMinutes, workDate: row.workDate
            )
            let updatedRow = WorklogRow(
                syncId: row.syncId, workDate: row.workDate, minutes: input.minutes, reportedMinutes: row.reportedMinutes,
                effectiveMinutes: billing.effectiveMinutes, earnedAmount: billing.earnedAmount,
                description: description, projectId: row.projectId, projectName: row.projectName,
                projectColor: row.projectColor, projectKind: row.projectKind, isBillable: row.isBillable,
                taskNumber: row.taskNumber, taskTitle: row.taskTitle, source: row.source
            )

            state.$dataset.withLock { current in
                guard let value = current else { return }
                let patched = value.worklogs.map { existing in
                    existing.syncId == row.syncId ? updatedRow : existing
                }
                current = value.replacing(worklogs: patched)
            }
            state.isSaving = true
            state.errorMessage = nil

            let payload = buildWorklogUpdate(input: input, now: nowString, billing: billing)
            let sharedDataset = state.$dataset
            let client = billingWriteClient
            return .run { send in
                do {
                    try await client.updateWorklog(row.syncId, payload)
                    await send(.writeFinished(.success(())))
                } catch {
                    sharedDataset.withLock { $0 = previousDataset }
                    await send(.writeFinished(.failure(.writeFailed)))
                }
            }
        }
    }

    // MARK: - Delete (edit mode only)

    private func delete(_ state: inout State) -> Effect<Action> {
        guard case let .edit(row) = state.mode else { return .none }
        guard canEdit(state.loadState) else {
            state.errorMessage = "Not editable while offline"
            return .none
        }
        guard state.dataset != nil else {
            state.errorMessage = "Not editable while offline"
            return .none
        }

        let previousDataset = state.dataset
        state.$dataset.withLock { current in
            guard let value = current else { return }
            current = value.replacing(worklogs: value.worklogs.filter { $0.syncId != row.syncId })
        }
        state.isSaving = true
        state.errorMessage = nil

        let nowString = Self.isoFormatter.string(from: now)
        let payload = softDelete(now: nowString)
        let sharedDataset = state.$dataset
        let client = billingWriteClient
        return .run { send in
            do {
                try await client.softDeleteWorklog(row.syncId, payload)
                await send(.writeFinished(.success(())))
            } catch {
                sharedDataset.withLock { $0 = previousDataset }
                await send(.writeFinished(.failure(.writeFailed)))
            }
        }
    }
}
