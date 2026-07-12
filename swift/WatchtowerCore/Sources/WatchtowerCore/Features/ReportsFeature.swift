import Foundation
import ComposableArchitecture

// UTC calendar/formatter for the "today" seed — must match the React
// `new Date().toISOString().slice(0,10)` behavior (always UTC).
private let reportsUtcDayFormatter: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    f.timeZone = TimeZone(identifier: "UTC")!
    f.locale = Locale(identifier: "en_US_POSIX")
    return f
}()

/// Filter state for the Reports tab. Owns the preset/granularity/project
/// selection and derives the concrete date range + effective granularity.
/// Mirrors `packages/module-timetracker/src/useReportsFilters.ts`.
@Reducer
public struct ReportsFeature {
    @ObservableState
    public struct State: Equatable {
        public var preset: Preset
        public var granularityChoice: Granularity?
        public var projectId: Int?
        public var today: String
        public var earliest: String?

        public init(
            preset: Preset = .d30,
            granularityChoice: Granularity? = nil,
            projectId: Int? = nil,
            today: String = "",
            earliest: String? = nil
        ) {
            self.preset = preset
            self.granularityChoice = granularityChoice
            self.projectId = projectId
            self.today = today
            self.earliest = earliest
        }

        /// Concrete `[from, to]` date range resolved from the preset.
        public var range: (from: String, to: String) {
            resolvePreset(preset, today: today, earliest: earliest)
        }

        /// Effective bucket granularity: user override (if any) else the
        /// preset default, clamped down for very wide ranges.
        public var granularity: Granularity {
            clampGranularity(granularityChoice ?? defaultGranularity(preset), from: range.from, to: range.to)
        }
    }

    public enum Action: Equatable {
        case onAppear(earliest: String?)
        case presetChanged(Preset)
        case granularityChanged(Granularity)
        case projectChanged(Int?)
        case openProjectTapped(Int)
    }

    @Dependency(\.date.now) var now

    public init() {}

    public var body: some ReducerOf<Self> {
        Reduce { state, action in
            switch action {
            case let .onAppear(earliest):
                state.today = reportsUtcDayFormatter.string(from: now)
                state.earliest = earliest
                return .none

            case let .presetChanged(preset):
                state.preset = preset
                state.granularityChoice = nil
                return .none

            case let .granularityChanged(granularity):
                state.granularityChoice = granularity
                return .none

            case let .projectChanged(id):
                state.projectId = id
                return .none

            case .openProjectTapped:
                // TODO(later phase): route to ProjectDetail
                return .none
            }
        }
    }
}
