import Foundation
import ComposableArchitecture

/// Create/edit/delete a single task, mirroring `WorklogFormFeature`'s
/// optimistic-write/rollback template exactly (validate synchronously,
/// snapshot, patch the shared `billingDataset` in place, fire the write
/// effect capturing the `Shared` box so a failure rolls back directly from
/// the effect, `writeFinished` only flips the plain `isSaving`/`errorMessage`
/// fields).
///
/// The one addition over the worklog template: `insertTask` is the first
/// write call in this write client that hands back a server-assigned id
/// (`Int`), so a brand-new task can't be optimistically inserted with its
/// real id — the create path mints a syncId-only placeholder row
/// (`taskId: 0`) up front, then swaps that placeholder's `taskId` to the
/// real one in a SECOND `$dataset.withLock` once `insertTask` resolves,
/// still inside the same `.run` effect (no extra action/round-trip needed).
@Reducer
public struct TaskFormFeature {
    @ObservableState
    public struct State: Equatable, Identifiable {
        public enum Mode: Equatable {
            case create(epicId: Int)
            case edit(TaskRow)
        }

        public let id: String
        public var mode: Mode
        public var numberText: String
        public var titleText: String
        public var status: String
        public var estimateText: String
        public var descriptionText: String
        public var isSaving: Bool
        public var errorMessage: String?

        @Shared(.inMemory("billingDataset")) public var dataset: BillingDataset? = nil
        @Shared(.inMemory("billingLoadState")) public var loadState: BillingFeature.LoadState = .loading

        public init(
            mode: Mode,
            numberText: String? = nil,
            titleText: String? = nil,
            status: String? = nil,
            estimateText: String? = nil,
            descriptionText: String? = nil,
            isSaving: Bool = false,
            errorMessage: String? = nil
        ) {
            self.mode = mode
            switch mode {
            case .create:
                self.id = UUID().uuidString
                self.numberText = numberText ?? ""
                self.titleText = titleText ?? ""
                self.status = status ?? "open"
                self.estimateText = estimateText ?? ""
                self.descriptionText = descriptionText ?? ""
            case let .edit(row):
                self.id = row.syncId
                self.numberText = numberText ?? (row.taskNumber ?? "")
                self.titleText = titleText ?? row.taskTitle
                self.status = status ?? row.status
                self.estimateText = estimateText ?? Self.formatEstimateText(minutes: row.estimatedMinutes)
                self.descriptionText = descriptionText ?? (row.description ?? "")
            }
            self.isSaving = isSaving
            self.errorMessage = errorMessage
        }

        private static func formatEstimateText(minutes: Int?) -> String {
            guard let minutes else { return "" }
            return String(format: "%d:%02d", minutes / 60, minutes % 60)
        }
    }

    /// Reuses `WorklogFormFeature`'s error type — every Milestone-3 editor
    /// feature's write effect fails the same way (a thrown error from the
    /// `BillingWriteClient` closure), so there's no reason for a second,
    /// identical `Error` enum.
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

    // MARK: - Save (create or edit)

    private func save(_ state: inout State) -> Effect<Action> {
        guard canEdit(state.loadState) else {
            state.errorMessage = "Not editable while offline"
            return .none
        }
        guard let dataset = state.dataset else {
            state.errorMessage = "Not editable while offline"
            return .none
        }
        if case let .edit(existing) = state.mode, !canEditTask(existing.status) {
            state.errorMessage = "Task is closed (Done)"
            return .none
        }
        let trimmedTitle = state.titleText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty else {
            state.errorMessage = "Enter a title"
            return .none
        }
        let estimatedMinutes: Double?
        let trimmedEstimate = state.estimateText.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedEstimate.isEmpty {
            estimatedMinutes = nil
        } else if let minutes = parseMinutes(trimmedEstimate) {
            estimatedMinutes = Double(minutes)
        } else {
            state.errorMessage = "Enter a valid estimate"
            return .none
        }

        let trimmedDescription = state.descriptionText.trimmingCharacters(in: .whitespacesAndNewlines)
        let description = trimmedDescription.isEmpty ? nil : trimmedDescription
        let nowString = Self.isoFormatter.string(from: now)

        // Snapshot BEFORE the optimistic patch, so a failed write can be
        // rolled back to exactly this value.
        let previousDataset = state.dataset

        switch state.mode {
        case let .create(epicId):
            guard let epic = dataset.epics.first(where: { $0.epicId == epicId }),
                  let project = dataset.projects.first(where: { $0.id == epic.projectId }) else {
                state.errorMessage = "Project not found"
                return .none
            }

            let syncId = uuid().uuidString
            let input = TaskWriteInput(
                epicId: epicId, number: state.numberText, title: trimmedTitle,
                status: state.status, estimatedMinutes: estimatedMinutes, description: description
            )
            let optimisticRow = TaskRow(
                taskId: 0, syncId: syncId, epicId: epicId, taskNumber: state.numberText,
                taskTitle: trimmedTitle, status: state.status,
                estimatedMinutes: estimatedMinutes.map(Int.init), description: description,
                projectId: project.id, projectName: project.name, projectColor: project.color,
                projectKind: project.kind, isBillable: project.isBillable, jiraStatus: nil
            )

            state.$dataset.withLock { current in
                guard let value = current else { return }
                current = value.replacing(tasks: value.tasks + [optimisticRow])
            }
            state.isSaving = true
            state.errorMessage = nil

            let payload = buildTaskInsert(input: input, syncId: syncId, now: nowString)
            let sharedDataset = state.$dataset
            let client = billingWriteClient
            return .run { send in
                do {
                    let newId = try await client.insertTask(payload)
                    sharedDataset.withLock { current in
                        guard let value = current else { return }
                        let patched = value.tasks.map { existing in
                            existing.syncId == syncId ? Self.withTaskId(existing, newId) : existing
                        }
                        current = value.replacing(tasks: patched)
                    }
                    await send(.writeFinished(.success(())))
                } catch {
                    sharedDataset.withLock { $0 = previousDataset }
                    await send(.writeFinished(.failure(.writeFailed)))
                }
            }

        case let .edit(row):
            let input = TaskWriteInput(
                epicId: row.epicId, number: state.numberText, title: trimmedTitle,
                status: state.status, estimatedMinutes: estimatedMinutes, description: description
            )
            let updatedRow = TaskRow(
                taskId: row.taskId, syncId: row.syncId, epicId: row.epicId, taskNumber: state.numberText,
                taskTitle: trimmedTitle, status: state.status,
                estimatedMinutes: estimatedMinutes.map(Int.init), description: description,
                projectId: row.projectId, projectName: row.projectName, projectColor: row.projectColor,
                projectKind: row.projectKind, isBillable: row.isBillable, jiraStatus: row.jiraStatus
            )

            state.$dataset.withLock { current in
                guard let value = current else { return }
                let patched = value.tasks.map { existing in
                    existing.syncId == row.syncId ? updatedRow : existing
                }
                current = value.replacing(tasks: patched)
            }
            state.isSaving = true
            state.errorMessage = nil

            let payload = buildTaskUpdate(input: input, now: nowString)
            let sharedDataset = state.$dataset
            let client = billingWriteClient
            return .run { send in
                do {
                    try await client.updateTask(row.syncId, payload)
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
        guard canEditTask(row.status) else {
            state.errorMessage = "Task is closed (Done)"
            return .none
        }

        let previousDataset = state.dataset
        state.$dataset.withLock { current in
            guard let value = current else { return }
            current = value.replacing(tasks: value.tasks.filter { $0.syncId != row.syncId })
        }
        state.isSaving = true
        state.errorMessage = nil

        let nowString = Self.isoFormatter.string(from: now)
        let payload = softDelete(now: nowString)
        let sharedDataset = state.$dataset
        let client = billingWriteClient
        return .run { send in
            do {
                try await client.deleteTask(row.syncId, payload)
                await send(.writeFinished(.success(())))
            } catch {
                sharedDataset.withLock { $0 = previousDataset }
                await send(.writeFinished(.failure(.writeFailed)))
            }
        }
    }

    private static func withTaskId(_ row: TaskRow, _ taskId: Int) -> TaskRow {
        TaskRow(
            taskId: taskId, syncId: row.syncId, epicId: row.epicId, taskNumber: row.taskNumber,
            taskTitle: row.taskTitle, status: row.status, estimatedMinutes: row.estimatedMinutes,
            description: row.description, projectId: row.projectId, projectName: row.projectName,
            projectColor: row.projectColor, projectKind: row.projectKind, isBillable: row.isBillable,
            jiraStatus: row.jiraStatus
        )
    }
}
