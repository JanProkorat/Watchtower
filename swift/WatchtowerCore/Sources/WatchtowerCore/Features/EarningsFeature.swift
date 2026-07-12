import Foundation
import ComposableArchitecture

// UTC calendar/formatter for the "current month" seed — must match the
// React `new Date().toISOString().slice(0,7)` behavior (always UTC).
private let earningsUtcMonthFormatter: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM"
    f.timeZone = TimeZone(identifier: "UTC")!
    f.locale = Locale(identifier: "en_US_POSIX")
    return f
}()

/// Selected-month state for the Earnings tab. Owns only the month cursor;
/// the dataset/list itself is driven by a parent/loader in a later phase.
@Reducer
public struct EarningsFeature {
    @ObservableState
    public struct State: Equatable {
        public var selectedMonth: String
        public init(selectedMonth: String = "") {
            self.selectedMonth = selectedMonth
        }
    }

    public enum Action: Equatable {
        case onAppear
        case monthStepped(Int)
        case openProjectTapped(Int)
    }

    @Dependency(\.date.now) var now

    public init() {}

    public var body: some ReducerOf<Self> {
        Reduce { state, action in
            switch action {
            case .onAppear:
                if state.selectedMonth.isEmpty {
                    state.selectedMonth = earningsUtcMonthFormatter.string(from: now)
                }
                return .none

            case let .monthStepped(delta):
                state.selectedMonth = CzFormat.addMonths(state.selectedMonth, delta)
                return .none

            case .openProjectTapped:
                // TODO(phase-4/5): route to ProjectDetail
                return .none
            }
        }
    }
}
