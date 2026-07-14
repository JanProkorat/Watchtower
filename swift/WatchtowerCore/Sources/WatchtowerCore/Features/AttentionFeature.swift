import ComposableArchitecture
import Foundation

/// Loads attention messages, groups them into threads, and surfaces load
/// errors. Follows `WorklogFormFeature`'s Result/error-action idiom: the
/// `.run` effect wraps the dependency call in a `do/catch` and always sends
/// a `Result`-wrapped response action, never lets the effect throw.
///
/// Reply (Task 11) extends `AttentionError` with a `replyFailed` case and
/// adds reply state/actions on top of this. The 5s poll loop (Task 12) is
/// wired to the sheet lifecycle, not this reducer — `onAppear`/`refresh`
/// here only perform a single load each.
@Reducer
public struct AttentionFeature: Sendable {
    @ObservableState
    public struct State: Equatable {
        public var threads: [AttentionThread] = []
        public var isLoading = false
        public var errorMessage: String?

        public var unansweredCount: Int {
            threads.filter(\.unanswered).count
        }

        public init(
            threads: [AttentionThread] = [],
            isLoading: Bool = false,
            errorMessage: String? = nil
        ) {
            self.threads = threads
            self.isLoading = isLoading
            self.errorMessage = errorMessage
        }
    }

    public enum Action: Equatable {
        case onAppear
        case refresh
        case threadsLoaded(Result<[AttentionMessage], AttentionError>)
    }

    /// Extensible: Task 11 adds `.replyFailed`.
    public enum AttentionError: Error, Equatable {
        case loadFailed
    }

    @Dependency(\.attentionClient) var attentionClient

    public init() {}

    public var body: some ReducerOf<Self> {
        Reduce { state, action in
            switch action {
            case .onAppear, .refresh:
                state.isLoading = true
                return .run { send in
                    do {
                        let rows = try await attentionClient.listThreads()
                        await send(.threadsLoaded(.success(rows)))
                    } catch {
                        await send(.threadsLoaded(.failure(.loadFailed)))
                    }
                }

            case let .threadsLoaded(.success(rows)):
                state.isLoading = false
                state.errorMessage = nil
                state.threads = groupThreads(rows)
                return .none

            case .threadsLoaded(.failure):
                state.isLoading = false
                state.errorMessage = "Couldn't load messages."
                return .none
            }
        }
    }
}
