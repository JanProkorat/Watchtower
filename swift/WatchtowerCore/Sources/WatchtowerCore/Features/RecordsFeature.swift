import Foundation
import ComposableArchitecture

// UTC calendar/formatter for the "current month" seed — must match the
// React `new Date().toISOString().slice(0,7)` behavior (always UTC).
private let recordsUtcMonthFormatter: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM"
    f.timeZone = TimeZone(identifier: "UTC")!
    f.locale = Locale(identifier: "en_US_POSIX")
    return f
}()

/// Segment + per-sub-view filter state for the Records tab (worklog list,
/// worklog grid, tasks, time-off, board). Also owns the presentation state
/// for the worklog/task editor sheets and the day-off set/clear mutations
/// (the row/affordance actions that drive them all live here rather than in
/// the not-yet-built views, per Task 12).
@Reducer
public struct RecordsFeature {
    public enum Section: String, CaseIterable, Equatable, Sendable {
        case list, grid, tasks, timeOff, board
    }

    @ObservableState
    public struct State: Equatable {
        public var section: Section
        public var worklogMonth: String
        public var worklogProjectId: Int?
        public var taskQuery: String
        public var gridMonth: String
        public var gridProjectIds: [Int]
        public var timeOffFocus: String
        public var boardProjectId: Int?

        @Presents public var worklogForm: WorklogFormFeature.State?
        @Presents public var taskForm: TaskFormFeature.State?

        @Shared(.inMemory("billingDataset")) public var dataset: BillingDataset? = nil
        @Shared(.inMemory("billingLoadState")) public var loadState: BillingFeature.LoadState = .loading

        public init(
            section: Section = .list,
            worklogMonth: String = "",
            worklogProjectId: Int? = nil,
            taskQuery: String = "",
            gridMonth: String = "",
            gridProjectIds: [Int] = [],
            timeOffFocus: String = "",
            boardProjectId: Int? = nil
        ) {
            self.section = section
            self.worklogMonth = worklogMonth
            self.worklogProjectId = worklogProjectId
            self.taskQuery = taskQuery
            self.gridMonth = gridMonth
            self.gridProjectIds = gridProjectIds
            self.timeOffFocus = timeOffFocus
            self.boardProjectId = boardProjectId
        }
    }

    // `RecordsFeature.Action` deliberately does NOT declare `Equatable`
    // (mirroring `AppFeature.Action`): it embeds
    // `PresentationAction<WorklogFormFeature.Action>` /
    // `PresentationAction<TaskFormFeature.Action>`, and the form features'
    // `Action` (a `BindableAction` carrying `BindingAction<State>`) isn't
    // itself `Equatable`, so synthesis would fail. Tests match via
    // case-key-path `store.receive(\.foo)` instead of full-action equality.
    public enum Action {
        case onAppear
        case sectionChanged(Section)
        case worklogMonthStepped(Int)
        case worklogProjectChanged(Int?)
        case taskQueryChanged(String)
        case gridMonthStepped(Int)
        case gridProjectToggled(Int)
        case timeOffFocusStepped(Int)
        case boardProjectChanged(Int?)

        case addWorklogTapped(date: String, task: TaskRow?)
        case worklogRowTapped(WorklogRow)
        case gridCellTapped(taskId: Int, date: String, existing: WorklogRow?)
        case addTaskTapped(epicId: Int)
        case taskRowTapped(TaskRow)

        case setDayOff(date: String, kind: String)
        case clearDayOff(date: String)
        /// Internal: dispatched once the async `sync_id` lookup (tier 2/3 of
        /// the resolution below) has settled, carrying the id to write with.
        case setDayOffResolved(date: String, kind: String, syncId: String)

        case worklogForm(PresentationAction<WorklogFormFeature.Action>)
        case taskForm(PresentationAction<TaskFormFeature.Action>)
    }

    @Dependency(\.date.now) var now
    @Dependency(\.uuid) var uuid
    @Dependency(\.billingWriteClient) var billingWriteClient

    public init() {}

    private static let isoFormatter = ISO8601DateFormatter()

    public var body: some ReducerOf<Self> {
        Reduce { state, action in
            switch action {
            case .onAppear:
                let seed = recordsUtcMonthFormatter.string(from: now)
                if state.worklogMonth.isEmpty { state.worklogMonth = seed }
                if state.gridMonth.isEmpty { state.gridMonth = seed }
                if state.timeOffFocus.isEmpty { state.timeOffFocus = seed }
                return .none

            case let .sectionChanged(section):
                state.section = section
                return .none

            case let .worklogMonthStepped(delta):
                state.worklogMonth = CzFormat.addMonths(state.worklogMonth, delta)
                return .none

            case let .worklogProjectChanged(id):
                state.worklogProjectId = id
                return .none

            case let .taskQueryChanged(query):
                state.taskQuery = query
                return .none

            case let .gridMonthStepped(delta):
                state.gridMonth = CzFormat.addMonths(state.gridMonth, delta)
                return .none

            case let .gridProjectToggled(id):
                if let index = state.gridProjectIds.firstIndex(of: id) {
                    state.gridProjectIds.remove(at: index)
                } else {
                    state.gridProjectIds.append(id)
                }
                return .none

            case let .timeOffFocusStepped(delta):
                state.timeOffFocus = CzFormat.addMonths(state.timeOffFocus, delta)
                return .none

            case let .boardProjectChanged(id):
                state.boardProjectId = id
                return .none

            case let .addWorklogTapped(date, task):
                // The editor form needs a resolved `TaskRow` up front (no
                // in-form task picker) — no-op if the caller couldn't
                // supply one.
                guard let task else { return .none }
                state.worklogForm = WorklogFormFeature.State(mode: .create(task: task, date: date))
                return .none

            case let .worklogRowTapped(row):
                state.worklogForm = WorklogFormFeature.State(mode: .edit(row))
                return .none

            case let .gridCellTapped(taskId, date, existing):
                if let existing {
                    state.worklogForm = WorklogFormFeature.State(mode: .edit(existing))
                } else {
                    guard let task = state.dataset?.tasks.first(where: { $0.taskId == taskId }) else {
                        return .none
                    }
                    state.worklogForm = WorklogFormFeature.State(mode: .create(task: task, date: date))
                }
                return .none

            case let .addTaskTapped(epicId):
                state.taskForm = TaskFormFeature.State(mode: .create(epicId: epicId))
                return .none

            case let .taskRowTapped(row):
                state.taskForm = TaskFormFeature.State(mode: .edit(row))
                return .none

            case .worklogForm(.presented(.delegate(.dismissed))):
                state.worklogForm = nil
                return .none

            case .worklogForm:
                return .none

            case .taskForm(.presented(.delegate(.dismissed))):
                state.taskForm = nil
                return .none

            case .taskForm:
                return .none

            case let .setDayOff(date, kind):
                return setDayOff(date: date, kind: kind, state: &state)

            case let .setDayOffResolved(date, kind, syncId):
                return applyDayOffUpsert(date: date, kind: kind, syncId: syncId, state: &state)

            case let .clearDayOff(date):
                return clearDayOff(date: date, state: &state)
            }
        }
        .ifLet(\.$worklogForm, action: \.worklogForm) {
            WorklogFormFeature()
        }
        .ifLet(\.$taskForm, action: \.taskForm) {
            TaskFormFeature()
        }
    }

    // MARK: - Day-off set (3-tier `sync_id` resolution)
    //
    // Mirrors `useDaysOffMutations.ts`'s `setDayOff`: re-marking a date that
    // has a tombstoned (soft-deleted) row must REUSE that row's `sync_id`,
    // because the upsert conflicts on `date` and the Mac's sync keys on
    // `sync_id` — minting a fresh id here would wedge convergence. Priority:
    //   1. a VISIBLE (non-deleted) cached row for `date` — reuse its id
    //      synchronously, no round-trip needed.
    //   2. else look it up INCLUDING soft-deleted rows via
    //      `findDayOffSyncId` — reuse if found (a tombstone exists).
    //   3. else mint a fresh uuid (truly new date, no row ever existed).
    private func setDayOff(date: String, kind: String, state: inout State) -> Effect<Action> {
        guard canEdit(state.loadState) else { return .none }
        guard let dataset = state.dataset else { return .none }

        // Tier 1: a visible cached row already carries the id to reuse.
        if let existing = dataset.daysOff.first(where: { $0.date == date }) {
            return applyDayOffUpsert(date: date, kind: kind, syncId: existing.syncId, state: &state)
        }

        // Tiers 2/3: resolve asynchronously, then re-enter via `setDayOffResolved`.
        let mintedId = uuid().uuidString
        let client = billingWriteClient
        return .run { send in
            // `try?` on an already-`Optional`-returning async throws call
            // flattens to a single `String?` (SE-0230) — a thrown lookup
            // error and "no row for this date" both fall through to minting
            // a fresh id (tier 3), which is the correct fallback either way.
            let syncId: String
            if let found = try? await client.findDayOffSyncId(date) {
                syncId = found
            } else {
                syncId = mintedId
            }
            await send(.setDayOffResolved(date: date, kind: kind, syncId: syncId))
        }
    }

    /// Shared optimistic-patch + write for a resolved `sync_id`, used by both
    /// the tier-1 synchronous path and the tier-2/3 `setDayOffResolved` path.
    private func applyDayOffUpsert(date: String, kind: String, syncId: String, state: inout State) -> Effect<Action> {
        guard canEdit(state.loadState) else { return .none }
        guard state.dataset != nil else { return .none }

        let nowString = Self.isoFormatter.string(from: now)
        let previousDataset = state.dataset
        let newRow = DayOffRow(date: date, kind: kind, syncId: syncId)

        state.$dataset.withLock { current in
            guard let value = current else { return }
            let patched = value.daysOff.filter { $0.date != date } + [newRow]
            current = value.replacing(daysOff: patched)
        }

        let payload = buildDayOffUpsert(date: date, kind: kind, syncId: syncId, now: nowString)
        let sharedDataset = state.$dataset
        let client = billingWriteClient
        return .run { _ in
            do {
                try await client.upsertDayOff(payload)
            } catch {
                sharedDataset.withLock { $0 = previousDataset }
            }
        }
    }

    // MARK: - Day-off clear

    private func clearDayOff(date: String, state: inout State) -> Effect<Action> {
        guard canEdit(state.loadState) else { return .none }
        guard let dataset = state.dataset else { return .none }
        guard dataset.daysOff.contains(where: { $0.date == date }) else { return .none }

        let previousDataset = state.dataset
        state.$dataset.withLock { current in
            guard let value = current else { return }
            current = value.replacing(daysOff: value.daysOff.filter { $0.date != date })
        }

        let nowString = Self.isoFormatter.string(from: now)
        let payload = softDelete(now: nowString)
        let sharedDataset = state.$dataset
        let client = billingWriteClient
        return .run { _ in
            do {
                try await client.deleteDayOff(date, payload)
            } catch {
                sharedDataset.withLock { $0 = previousDataset }
            }
        }
    }
}
