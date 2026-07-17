import Foundation
import ComposableArchitecture

/// Connection settings editor — the native replacement for the Capacitor
/// SettingsModule connection form (and the proper fix for issue #161).
@Reducer
public struct ConnectionFeature {
    @ObservableState
    public struct State: Equatable {
        public var form = ConnectionFormState()
        public var saved: Connection?
        public var status: ConnStatus = .disconnected
        public var errorMessage: String?
        /// Brief "Saved" confirmation; cleared on the next edit.
        public var didSave = false

        public init() {}
    }

    public enum Action: BindableAction {
        case binding(BindingAction<State>)
        case onAppear
        case saveTapped
        case statusChanged(ConnStatus)
    }

    private enum CancelID { case status }

    @Dependency(\.connectionStore) var connectionStore
    @Dependency(\.bridge) var bridge

    public init() {}

    public var body: some ReducerOf<Self> {
        BindingReducer()
        Reduce { state, action in
            switch action {
            case .binding:
                state.didSave = false
                return .none

            case .onAppear:
                if let saved = connectionStore.load() {
                    state.saved = saved
                    state.form = ConnectionFormState(saved)
                }
                return .run { send in
                    for await s in await bridge.statusStream() {
                        await send(.statusChanged(s))
                    }
                }
                .cancellable(id: CancelID.status, cancelInFlight: true)

            case .saveTapped:
                switch parseConnection(state.form) {
                case let .failure(err):
                    state.errorMessage = err.message
                    return .none
                case let .success(conn):
                    state.errorMessage = nil
                    state.saved = conn
                    state.didSave = true
                    connectionStore.save(conn)
                    return .run { _ in await bridge.configure(conn) }
                }

            case let .statusChanged(s):
                state.status = s
                return .none
            }
        }
    }
}
