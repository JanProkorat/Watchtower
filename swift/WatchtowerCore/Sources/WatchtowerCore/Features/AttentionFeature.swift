import ComposableArchitecture
import Foundation

/// Loads attention messages, groups them into threads, and surfaces load
/// errors. Follows `WorklogFormFeature`'s Result/error-action idiom: the
/// `.run` effect wraps the dependency call in a `do/catch` and always sends
/// a `Result`-wrapped response action, never lets the effect throw.
///
/// Reply (Task 11) follows `WorklogFormFeature`'s optimistic-then-rollback
/// idiom: `sendReply` synchronously clears the draft and flips `isSending`
/// before the `.run` effect fires, so the UI reflects the send immediately;
/// on failure `replyFinished(.failure)` restores the draft it captured
/// before the optimistic clear. The 5s poll loop (Task 12) is wired to the
/// sheet lifecycle, not this reducer — `onAppear`/`refresh` here only
/// perform a single load each.
@Reducer
public struct AttentionFeature: Sendable {
    @ObservableState
    public struct State: Equatable {
        public var threads: [AttentionThread] = []
        public var isLoading = false
        public var errorMessage: String?

        /// Per-instance reply draft text, keyed by `instanceId`. Cleared
        /// optimistically on `sendReply`, restored on failure.
        public var replyDrafts: [String: String] = [:]
        public var isSending = false

        public var unansweredCount: Int {
            threads.filter(\.unanswered).count
        }

        public init(
            threads: [AttentionThread] = [],
            isLoading: Bool = false,
            errorMessage: String? = nil,
            replyDrafts: [String: String] = [:],
            isSending: Bool = false
        ) {
            self.threads = threads
            self.isLoading = isLoading
            self.errorMessage = errorMessage
            self.replyDrafts = replyDrafts
            self.isSending = isSending
        }
    }

    /// Not `Equatable`: `.replyFinished` wraps `Result<Void, AttentionError>`,
    /// and `Void` has no `Equatable` conformance in the standard library.
    /// The `@Reducer` macro still derives `CasePathable`, which is all
    /// `TestStore.receive(\.case)` needs — mirrors `WorklogFormFeature.Action`,
    /// which drops `Equatable` for the same reason (`Result<Void, BillingWriteError>`).
    public enum Action {
        case onAppear
        case refresh
        case threadsLoaded(Result<[AttentionMessage], AttentionError>)
        case replyDraftChanged(instanceId: String, text: String)
        case sendReply(instanceId: String, replyTo: String)
        case replyFinished(Result<Void, AttentionError>)
        /// Poll lifecycle (Task 12): started/stopped by the drawer's
        /// sheet appearing/disappearing. `startPolling` fires `.refresh`
        /// every 5s via `continuousClock` until `stopPolling` cancels it —
        /// keeps the poll from running while the drawer is closed.
        case startPolling
        case stopPolling
    }

    public enum AttentionError: Error, Equatable {
        case loadFailed
        case replyFailed(instanceId: String, draft: String)
    }

    private enum CancelID {
        case poll
    }

    @Dependency(\.attentionClient) var attentionClient
    @Dependency(\.uuid) var uuid
    @Dependency(\.date.now) var now
    @Dependency(\.continuousClock) var clock

    public init() {}

    private static let isoFormatter = ISO8601DateFormatter()

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

            case let .replyDraftChanged(instanceId, text):
                state.replyDrafts[instanceId] = text
                return .none

            case let .sendReply(instanceId, replyTo):
                let text = state.replyDrafts[instanceId] ?? ""
                guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return .none }
                let previousDraft = text
                state.isSending = true
                state.replyDrafts[instanceId] = ""          // optimistic clear
                let syncId = uuid().uuidString
                let createdAt = Self.isoFormatter.string(from: now)
                let client = attentionClient
                return .run { send in
                    do {
                        try await client.reply(instanceId, replyTo, text, syncId, createdAt)
                        await send(.replyFinished(.success(())))
                    } catch {
                        await send(.replyFinished(.failure(.replyFailed(instanceId: instanceId, draft: previousDraft))))
                    }
                }

            case .replyFinished(.success):
                state.isSending = false
                return .none

            case let .replyFinished(.failure(err)):
                state.isSending = false
                if case let .replyFailed(instanceId, draft) = err {
                    state.replyDrafts[instanceId] = draft
                }
                state.errorMessage = "Couldn't send reply."
                return .none

            case .startPolling:
                return .run { send in
                    for await _ in clock.timer(interval: .seconds(5)) {
                        await send(.refresh)
                    }
                }
                .cancellable(id: CancelID.poll, cancelInFlight: true)

            case .stopPolling:
                return .cancel(id: CancelID.poll)
            }
        }
    }
}
