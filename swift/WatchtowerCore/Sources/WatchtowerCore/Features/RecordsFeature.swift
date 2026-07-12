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
/// worklog grid, tasks, time-off). Each sub-view owns its own read-only
/// filter cursor; nothing here fetches data — that's a later phase's loader.
@Reducer
public struct RecordsFeature {
    public enum Section: String, CaseIterable, Equatable, Sendable {
        case list, grid, tasks, timeOff
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

        public init(
            section: Section = .list,
            worklogMonth: String = "",
            worklogProjectId: Int? = nil,
            taskQuery: String = "",
            gridMonth: String = "",
            gridProjectIds: [Int] = [],
            timeOffFocus: String = ""
        ) {
            self.section = section
            self.worklogMonth = worklogMonth
            self.worklogProjectId = worklogProjectId
            self.taskQuery = taskQuery
            self.gridMonth = gridMonth
            self.gridProjectIds = gridProjectIds
            self.timeOffFocus = timeOffFocus
        }
    }

    public enum Action: Equatable {
        case onAppear
        case sectionChanged(Section)
        case worklogMonthStepped(Int)
        case worklogProjectChanged(Int?)
        case taskQueryChanged(String)
        case gridMonthStepped(Int)
        case gridProjectToggled(Int)
        case timeOffFocusStepped(Int)
    }

    @Dependency(\.date.now) var now

    public init() {}

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
            }
        }
    }
}
